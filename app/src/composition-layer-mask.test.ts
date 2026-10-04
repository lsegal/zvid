import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  drawLayerMask,
  findMaskTargetSteps,
} from "./composition-layer-mask.ts";
import {
  type LayerDrawStep,
  planLayerDraws,
  type StackedLayer,
} from "./composition-layout.ts";
import { Z_ORDER_COMPOSITION } from "./composition-order.ts";
import type { EffectChainRenderer } from "./fx-shaders/chain.ts";

type Layer = StackedLayer & { id: string; fx?: boolean };

function layer(id: string, laneId: string, laneRank: number, fx?: boolean) {
  return {
    id,
    laneRank,
    clip: { startQ: 0, laneId },
    ...(fx ? { fx } : {}),
  } satisfies Layer;
}

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

describe("drawLayerMask", () => {
  // Records the GL calls drawing a mask makes.
  function fakeResources() {
    const calls: string[] = [];
    const gl = {
      COLOR_BUFFER_BIT: 1,
      SCISSOR_TEST: 2,
      clearColor: (...rgba: number[]) => calls.push(`clearColor ${rgba}`),
      clear: () => calls.push("clear"),
      disable: () => calls.push("disable"),
    } as unknown as WebGLRenderingContext;
    const framebuffer = {} as WebGLFramebuffer;
    const region = {
      texture: {} as WebGLTexture,
      uvScale: [1, 1] as [number, number],
      uvMax: [1, 1] as [number, number],
    };
    const effectChain = {
      getMaskTarget: (width: number, height: number) => {
        calls.push(`target ${width}x${height}`);
        return { framebuffer, region };
      },
    } as unknown as EffectChainRenderer;
    return { calls, framebuffer, region, resources: { gl, effectChain } };
  }

  const surface = { framebuffer: null, width: 64, height: 32 };

  it("draws nothing for a target with no active clip", () => {
    const { calls, resources } = fakeResources();
    const drawn = drawLayerMask(
      resources,
      [],
      { targetLaneId: "2", mode: "subtractive" },
      surface,
      () => calls.push("bind"),
      () => calls.push("draw"),
    );
    assert.equal(drawn, null);
    assert.deepEqual(calls, []);
  });

  it("draws the target's clips into a cleared mask the surface's size", () => {
    const { calls, framebuffer, region, resources } = fakeResources();
    const drawnInto: unknown[] = [];
    const drawn = drawLayerMask(
      resources,
      ["a", "b"],
      { targetLaneId: "2", mode: "subtractive" },
      surface,
      (target) => {
        calls.push("bind");
        drawnInto.push(target.framebuffer);
      },
      (target, step) => {
        calls.push(`draw ${step}`);
        drawnInto.push(target.framebuffer);
      },
    );
    assert.deepEqual(drawn, { region, mode: "subtractive" });
    assert.deepEqual(calls, [
      "target 64x32",
      "bind",
      "clearColor 0,0,0,0",
      "clear",
      "draw a",
      "draw b",
      "disable",
    ]);
    assert.ok(drawnInto.every((target) => target === framebuffer));
  });
});
