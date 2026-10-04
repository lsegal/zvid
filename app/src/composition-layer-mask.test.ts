import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  drawLayerMask,
  findMaskTargetSteps,
  findMaskTargets,
  inverseArrangementAxes,
  type MaskDrawing,
} from "./composition-layer-mask.ts";
import {
  type LayerDrawStep,
  planLayerDraws,
  type StackedLayer,
  type TransitionComps,
} from "./composition-layout.ts";
import {
  type CompositionOrder,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";
import type { QuadAxes } from "./composition-transform.ts";
import type { EffectChainRenderer } from "./fx-shaders/chain.ts";

type Layer = StackedLayer & {
  id: string;
  fx?: boolean;
  order?: CompositionOrder;
  transition?: TransitionComps;
};

function layer(id: string, laneId: string, laneRank: number, fx?: boolean) {
  return {
    id,
    laneRank,
    clip: { startQ: 0, laneId },
    ...(fx ? { fx } : {}),
  } satisfies Layer;
}

// An FX clip whose Order arranges the layers beneath it.
function arranger(id: string, laneId: string, laneRank: number): Layer {
  return {
    ...layer(id, laneId, laneRank, true),
    order: { arrangement: "vertical", gridSize: 2, spacing: 0 },
  };
}

type LayerStep = LayerDrawStep<Layer> & { type: "layer" };
type ArrangeStep = LayerDrawStep<Layer> & { type: "arrange" };

// Every layer step in `steps`, at any depth, by its layer's id.
function layerSteps(steps: readonly LayerDrawStep<Layer>[]) {
  const found = new Map<string, LayerStep>();
  const visit = (list: readonly LayerDrawStep<Layer>[]) => {
    for (const step of list) {
      if (step.type === "layer") found.set(step.entry.id, step);
      else if (step.type === "arrange") visit(step.steps);
      else if (step.type === "transition") {
        visit(step.outgoing);
        visit(step.incoming);
      }
    }
  };
  visit(steps);
  return found;
}

const pathIds = (path: readonly ArrangeStep[]) =>
  path.map((step) => step.entry.id);

const ids = (steps: readonly LayerDrawStep<Layer>[]) =>
  steps.map((step) => step.entry.id);

describe("findMaskTargetSteps", () => {
  const masked = layer("masked", "1", 0);
  const additive = { targetLaneId: "2", mode: "additive" } as const;

  it("finds the target layer's clips drawn on the same surface", () => {
    const steps = planLayerDraws<Layer>(
      [masked, layer("a", "2", 1), layer("b", "2", 1), layer("c", "3", 2)],
      Z_ORDER_COMPOSITION,
    );
    assert.deepEqual(ids(findMaskTargetSteps(steps, masked, additive)), [
      "a",
      "b",
    ]);
  });

  it("finds nothing when the target has no active clip", () => {
    const steps = planLayerDraws<Layer>(
      [masked, layer("c", "3", 2)],
      Z_ORDER_COMPOSITION,
    );
    assert.deepEqual(findMaskTargetSteps(steps, masked, additive), []);
  });

  it("skips FX clips and the masked clip itself", () => {
    const steps = planLayerDraws<Layer>(
      [masked, layer("fx", "2", 1, true)],
      Z_ORDER_COMPOSITION,
    );
    assert.deepEqual(findMaskTargetSteps(steps, masked, additive), []);
    assert.deepEqual(
      findMaskTargetSteps(steps, masked, {
        targetLaneId: "1",
        mode: "additive",
      }),
      [],
    );
  });
});

describe("findMaskTargets", () => {
  const additive = { targetLaneId: "4", mode: "additive" } as const;

  it("finds a Target in the Transition comp the masked layer is in", () => {
    const masked = {
      ...layer("masked", "3", 2),
      clip: { id: "masked", startQ: 0, laneId: "3" },
    };
    const target = {
      ...layer("t", "4", 3),
      clip: { id: "t", startQ: 0, laneId: "4" },
    };
    const steps = planLayerDraws<Layer>(
      [
        {
          ...layer("fx", "1", 0, true),
          transition: {
            outgoing: new Set(["masked", "t"]),
            incoming: new Set(),
          },
        },
        masked,
        target,
      ],
      Z_ORDER_COMPOSITION,
    );
    const found = findMaskTargets(
      steps,
      layerSteps(steps).get("masked") as LayerStep,
      additive,
    );
    assert.deepEqual(pathIds(found.maskedPath), []);
    assert.deepEqual(
      found.groups.map((group) => [pathIds(group.path), ids(group.steps)]),
      [[[], ["t"]]],
    );
  });

  it("finds a Target inside an FX clip's arrangement the masked layer is outside", () => {
    const masked = layer("masked", "1", 0);
    const steps = planLayerDraws<Layer>(
      [masked, arranger("fx", "2", 1), layer("t", "4", 3)],
      Z_ORDER_COMPOSITION,
    );
    const found = findMaskTargets(
      steps,
      layerSteps(steps).get("masked") as LayerStep,
      additive,
    );
    assert.deepEqual(pathIds(found.maskedPath), []);
    assert.deepEqual(
      found.groups.map((group) => [pathIds(group.path), ids(group.steps)]),
      [[["fx"], ["t"]]],
    );
  });

  it("finds a Target outside the arrangement the masked layer is in", () => {
    const masked = layer("masked", "3", 2);
    const steps = planLayerDraws<Layer>(
      [layer("t", "4", 0), arranger("fx", "2", 1), masked],
      Z_ORDER_COMPOSITION,
    );
    const found = findMaskTargets(
      steps,
      layerSteps(steps).get("masked") as LayerStep,
      additive,
    );
    assert.deepEqual(pathIds(found.maskedPath), ["fx"]);
    assert.deepEqual(
      found.groups.map((group) => [pathIds(group.path), ids(group.steps)]),
      [[[], ["t"]]],
    );
  });

  it("finds nothing when the target has no active clip anywhere", () => {
    const masked = layer("masked", "3", 2);
    const steps = planLayerDraws<Layer>(
      [arranger("fx", "2", 1), masked],
      Z_ORDER_COMPOSITION,
    );
    const found = findMaskTargets(
      steps,
      layerSteps(steps).get("masked") as LayerStep,
      additive,
    );
    assert.deepEqual(found.groups, []);
  });
});

describe("inverseArrangementAxes", () => {
  // Where drawing a bottom-up picture with `axes` puts its own clip-space
  // point `q`.
  const place = (axes: QuadAxes, [x, y]: [number, number]) => [
    axes.axisX[0] * x - axes.axisY[0] * y + axes.offset[0],
    axes.axisX[1] * x - axes.axisY[1] * y + axes.offset[1],
  ];

  it("undoes a turned, scaled and moved arrangement", () => {
    const axes: QuadAxes = {
      axisX: [0.3, 0.4],
      axisY: [0.2, -0.5],
      offset: [0.1, -0.25],
    };
    const inverse = inverseArrangementAxes(axes);
    for (const point of [
      [0, 0],
      [1, -1],
      [-0.5, 0.75],
    ] as Array<[number, number]>) {
      const [x, y] = place(inverse, place(axes, point) as [number, number]);
      assert.ok(Math.abs(x - point[0]) < 1e-9);
      assert.ok(Math.abs(y - point[1]) < 1e-9);
    }
  });

  it("keeps the whole-surface draw of a bottom-up picture", () => {
    const whole: QuadAxes = { axisX: [1, 0], axisY: [0, -1], offset: [0, 0] };
    const inverse = inverseArrangementAxes(whole);
    assert.deepEqual(
      inverse.axisX.map((value) => value + 0),
      whole.axisX,
    );
    assert.deepEqual(
      inverse.axisY.map((value) => value + 0),
      whole.axisY,
    );
    assert.deepEqual(
      inverse.offset.map((value) => value + 0),
      whole.offset,
    );
  });
});

describe("drawLayerMask", () => {
  // Records the GL calls and draws drawing a mask makes. Each arrangement
  // is half its parent's width.
  function fakeDrawing() {
    const calls: string[] = [];
    const gl = {
      COLOR_BUFFER_BIT: 1,
      SCISSOR_TEST: 2,
      clearColor: (...rgba: number[]) => calls.push(`clearColor ${rgba}`),
      clear: () => calls.push("clear"),
      disable: () => calls.push("disable"),
    } as unknown as WebGLRenderingContext;
    const targets = new Map<number, WebGLFramebuffer>();
    const regionFor = (slot: number) => ({
      texture: { slot } as unknown as WebGLTexture,
      uvScale: [1, 1] as [number, number],
      uvMax: [1, 1] as [number, number],
    });
    const slotOf = (framebuffer: WebGLFramebuffer | null) =>
      [...targets].find(([, value]) => value === framebuffer)?.[0];
    const effectChain = {
      getMaskTarget: (width: number, height: number, slot = 0) => {
        calls.push(`target ${slot} ${width}x${height}`);
        if (!targets.has(slot)) targets.set(slot, {} as WebGLFramebuffer);
        return { framebuffer: targets.get(slot), region: regionFor(slot) };
      },
    } as unknown as EffectChainRenderer;
    const axes: QuadAxes = { axisX: [0.5, 0], axisY: [0, -1], offset: [0, 0] };
    const drawing: MaskDrawing<Layer> = {
      gl,
      effectChain,
      bind: (target) => calls.push(`bind ${slotOf(target.framebuffer)}`),
      placeArrangement: (_step, parent) => ({
        size: { width: parent.width / 2, height: parent.height },
        axes,
      }),
      drawStep: (target, step, slot) =>
        calls.push(
          `draw ${step.entry.id} into ${slotOf(target.framebuffer)}, masks from ${slot}`,
        ),
      drawHop: (target, source, hopAxes) =>
        calls.push(
          `hop ${(source.texture as unknown as { slot: number }).slot} into ${slotOf(target.framebuffer)}${hopAxes === axes ? "" : " inverted"}`,
        ),
    };
    return { calls, drawing, regionFor };
  }

  const canvas = { width: 64, height: 32 };

  it("draws nothing for a target with no active clip", () => {
    const { calls, drawing } = fakeDrawing();
    const drawn = drawLayerMask(
      drawing,
      { maskedPath: [], groups: [] },
      { targetLaneId: "2", mode: "subtractive" },
      canvas,
    );
    assert.equal(drawn, null);
    assert.deepEqual(calls, []);
  });

  it("draws the target's clips on the same surface into a cleared mask", () => {
    const { calls, drawing, regionFor } = fakeDrawing();
    const steps = planLayerDraws<Layer>(
      [layer("masked", "1", 0), layer("a", "2", 1), layer("b", "2", 1)],
      Z_ORDER_COMPOSITION,
    );
    const found = layerSteps(steps);
    const drawn = drawLayerMask(
      drawing,
      {
        maskedPath: [],
        groups: [
          {
            path: [],
            steps: [found.get("a"), found.get("b")] as LayerStep[],
          },
        ],
      },
      { targetLaneId: "2", mode: "subtractive" },
      canvas,
      3,
    );
    assert.deepEqual(drawn, { region: regionFor(3), mode: "subtractive" });
    assert.deepEqual(calls, [
      "target 3 64x32",
      "bind 3",
      "clearColor 0,0,0,0",
      "clear",
      "draw a into 3, masks from 6",
      "draw b into 3, masks from 6",
      "disable",
    ]);
  });

  it("carries a Target out of its arrangement and into the masked layer's", () => {
    const { calls, drawing, regionFor } = fakeDrawing();
    const steps = planLayerDraws<Layer>(
      [layer("t", "4", 0), arranger("fx", "2", 1), layer("masked", "3", 2)],
      Z_ORDER_COMPOSITION,
    );
    const outer = steps.find((step) => step.type === "arrange") as ArrangeStep;
    const inner = { ...outer };
    const drawn = drawLayerMask(
      drawing,
      {
        maskedPath: [outer],
        groups: [
          {
            path: [inner],
            steps: [layerSteps(steps).get("t") as LayerStep],
          },
        ],
      },
      { targetLaneId: "4", mode: "additive" },
      canvas,
    );
    assert.deepEqual(drawn, { region: regionFor(0), mode: "additive" });
    assert.deepEqual(calls, [
      // The mask, on the masked layer's 32 × 32 arrangement.
      "target 0 32x32",
      "bind 0",
      "clearColor 0,0,0,0",
      "clear",
      // The Target, on its own arrangement.
      "target 1 32x32",
      "bind 1",
      "clearColor 0,0,0,0",
      "clear",
      "draw t into 1, masks from 3",
      // Out onto the canvas, then into the masked layer's arrangement.
      "target 2 64x32",
      "bind 2",
      "clearColor 0,0,0,0",
      "clear",
      "hop 1 into 2",
      "hop 2 into 0 inverted",
      "disable",
    ]);
  });
});
