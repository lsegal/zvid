import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findAnimatedOrder } from "./composition-active-clips.ts";
import {
  type FrameBounds,
  type LayerDrawStep,
  planLayerDraws,
  resolveSlotBounds,
  resolveSlotScissor,
} from "./composition-layout.ts";
import type { CompositionOrder, OrderSlide } from "./composition-order.ts";
import {
  applyClipAnimationWeight,
  orderSlideWeight,
  resolveOrderSlide,
} from "./fx-animation-clip.ts";
import {
  createDefaultAnimation,
  type EffectAnimation,
} from "./fx-animation-defaults.ts";
import { easeMotion } from "./motion-easing.ts";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
// Order's Normal timing, with its default Ease Out in and Ease In out.
const SLIDE: OrderSlide = {
  motionIn: "Ease Out",
  motionOut: "Ease In",
  frames: 5,
  fps: FPS,
};

type Layer = {
  id: string;
  laneRank: number;
  clip: { startQ: number; durationSeconds: number };
  clipProgress: number;
};

type Rect = { left: number; right: number; top: number; bottom: number };

// A clip on layer `laneRank` from `startSeconds` for `durationSeconds`, at
// `seconds` on the timeline.
function layer(
  laneRank: number,
  startSeconds: number,
  durationSeconds: number,
  seconds: number,
): Layer {
  return {
    id: `layer-${laneRank + 1}`,
    laneRank,
    clip: { startQ: startSeconds, durationSeconds },
    clipProgress: Math.max(
      0,
      Math.min(1, (seconds - startSeconds) / durationSeconds),
    ),
  };
}

function order(
  arrangement: CompositionOrder["arrangement"],
  slide: OrderSlide | null = SLIDE,
): CompositionOrder {
  return {
    arrangement,
    gridSize: 2,
    spacing: 0,
    ...(slide ? { slide } : {}),
  };
}

function toRect(bounds: FrameBounds): Rect {
  return {
    left: ((bounds.centerX - bounds.halfWidth + 1) / 2) * WIDTH,
    right: ((bounds.centerX + bounds.halfWidth + 1) / 2) * WIDTH,
    top: ((1 - bounds.centerY - bounds.halfHeight) / 2) * HEIGHT,
    bottom: ((1 - bounds.centerY + bounds.halfHeight) / 2) * HEIGHT,
  };
}

type Placed = { id: string; drawn: Rect; cropped: Rect };

// Where each layer is drawn, and the box it is cropped to, in canvas
// pixels (origin top-left).
function place(steps: LayerDrawStep<Layer>[]): Placed[] {
  return steps.flatMap((step) => {
    if (step.type !== "layer") {
      return [];
    }
    const scissor = resolveSlotScissor(
      step.slot,
      step.slotCount,
      step.order,
      WIDTH,
      HEIGHT,
      step.motion,
    );
    return [
      {
        id: step.entry.id,
        drawn: toRect(
          resolveSlotBounds(
            step.slot,
            step.slotCount,
            step.order,
            WIDTH,
            HEIGHT,
            step.motion,
          ),
        ),
        cropped: {
          left: scissor.x,
          right: scissor.x + scissor.width,
          top: HEIGHT - scissor.y - scissor.height,
          bottom: HEIGHT - scissor.y,
        },
      },
    ];
  });
}

function placeAt(
  layers: Layer[],
  arrangement: CompositionOrder = order("vertical"),
) {
  return Object.fromEntries(
    place(planLayerDraws(layers, arrangement)).map((placed) => [
      placed.id,
      placed,
    ]),
  );
}

function lerpRect(from: Rect, to: Rect, weight: number): Rect {
  const at = (key: keyof Rect) => from[key] + (to[key] - from[key]) * weight;
  return {
    left: at("left"),
    right: at("right"),
    top: at("top"),
    bottom: at("bottom"),
  };
}

function assertRect(actual: Rect, expected: Rect, message: string) {
  for (const key of ["left", "right", "top", "bottom"] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 1e-6,
      `${message} ${key}: ${actual[key]} != ${expected[key]}`,
    );
  }
}

const FULL: Rect = { left: 0, right: WIDTH, top: 0, bottom: HEIGHT };
const TOP_HALF: Rect = { left: 0, right: WIDTH, top: 0, bottom: HEIGHT / 2 };
const BOTTOM_HALF: Rect = {
  left: 0,
  right: WIDTH,
  top: HEIGHT / 2,
  bottom: HEIGHT,
};

// Layer 1 plays throughout; Layer 2's clip plays from 2 s to 6 s.
function twoLayersAt(seconds: number) {
  return placeAt([layer(0, 0, 10, seconds), layer(1, 2, 4, seconds)]);
}

describe("Order Clip-mode animation", () => {
  it("slides an entering clip in from the left while Layer 1 shrinks to its half", () => {
    for (let frame = 0; frame <= 5; frame++) {
      const placed = twoLayersAt(2 + frame / FPS);
      const weight = easeMotion("Ease Out", frame / 5);
      assertRect(
        placed["layer-1"].drawn,
        lerpRect(FULL, TOP_HALF, weight),
        `Layer 1 at frame ${frame}`,
      );
      assertRect(
        placed["layer-2"].drawn,
        {
          ...BOTTOM_HALF,
          left: -WIDTH * (1 - weight),
          right: WIDTH * weight,
        },
        `Layer 2 at frame ${frame}`,
      );
      // It is cropped to its slot all the way in.
      assertRect(
        placed["layer-2"].cropped,
        BOTTOM_HALF,
        `Layer 2's crop at frame ${frame}`,
      );
    }
  });

  it("settles into the plain arrangement once the slide is done", () => {
    const steps = planLayerDraws(
      [layer(0, 0, 10, 2.5), layer(1, 2, 4, 2.5)],
      order("vertical"),
    );
    assert.ok(steps.every((step) => !("motion" in step)));
    const placed = twoLayersAt(2.5);
    assertRect(placed["layer-1"].drawn, TOP_HALF, "Layer 1");
    assertRect(placed["layer-2"].drawn, BOTTOM_HALF, "Layer 2");
  });

  it("mirrors the enter when a clip exits", () => {
    const mirrored = { ...SLIDE, motionOut: SLIDE.motionIn };
    for (let frame = 0; frame <= 5; frame++) {
      const at = (seconds: number) =>
        placeAt(
          [layer(0, 0, 10, seconds), layer(1, 2, 4, seconds)],
          order("vertical", mirrored),
        );
      const entering = at(2 + frame / FPS);
      const exiting = at(6 - frame / FPS);
      for (const id of ["layer-1", "layer-2"]) {
        assertRect(
          exiting[id].drawn,
          entering[id].drawn,
          `${id} at frame ${frame}`,
        );
        assertRect(
          exiting[id].cropped,
          entering[id].cropped,
          `${id}'s crop at frame ${frame}`,
        );
      }
    }
    // With the default Ease In out, the exit follows Ease In.
    const exiting = twoLayersAt(6 - 2 / FPS);
    assertRect(
      exiting["layer-1"].drawn,
      lerpRect(FULL, TOP_HALF, easeMotion("Ease In", 2 / 5)),
      "Layer 1 as Layer 2 exits",
    );
  });

  it("slides into a Horizontal column from the bottom", () => {
    const placed = placeAt(
      [layer(0, 0, 10, 2 + 2 / FPS), layer(1, 2, 4, 2 + 2 / FPS)],
      order("horizontal"),
    );
    const weight = easeMotion("Ease Out", 2 / 5);
    const column = { left: WIDTH / 2, right: WIDTH, top: 0, bottom: HEIGHT };
    assertRect(
      placed["layer-2"].drawn,
      {
        ...column,
        top: HEIGHT * (1 - weight),
        bottom: HEIGHT * (2 - weight),
      },
      "Layer 2",
    );
    assertRect(placed["layer-2"].cropped, column, "Layer 2's crop");
    assertRect(
      placed["layer-1"].drawn,
      lerpRect(FULL, { ...column, left: 0, right: WIDTH / 2 }, weight),
      "Layer 1",
    );
  });

  it("slides into a Grid cell from its nearest canvas edge", () => {
    const seconds = 2 + 1 / FPS;
    const weight = easeMotion("Ease Out", 1 / 5);
    const placed = placeAt(
      [
        layer(0, 0, 10, seconds),
        layer(1, 2, 4, seconds),
        layer(2, 0, 10, seconds),
        layer(3, 0, 10, seconds),
      ],
      order("grid"),
    );
    // Layer 2 enters the top-right cell, from the right.
    const cell = { left: WIDTH / 2, right: WIDTH, top: 0, bottom: HEIGHT / 2 };
    assertRect(
      placed["layer-2"].drawn,
      {
        ...cell,
        left: WIDTH / 2 + (WIDTH / 2) * (1 - weight),
        right: WIDTH + (WIDTH / 2) * (1 - weight),
      },
      "Layer 2",
    );
    assertRect(placed["layer-2"].cropped, cell, "Layer 2's crop");
    // Layer 3 glides from the top-right cell to the bottom-left one.
    assertRect(
      placed["layer-3"].drawn,
      lerpRect(
        cell,
        { left: 0, right: WIDTH / 2, top: HEIGHT / 2, bottom: HEIGHT },
        weight,
      ),
      "Layer 3",
    );
  });

  it("moves clips that enter together as one", () => {
    const seconds = 2 + 3 / FPS;
    const weight = easeMotion("Ease Out", 3 / 5);
    const placed = placeAt([
      layer(0, 0, 10, seconds),
      layer(1, 2, 4, seconds),
      layer(2, 2, 3, seconds),
    ]);
    assertRect(
      placed["layer-1"].drawn,
      lerpRect(FULL, { ...FULL, bottom: HEIGHT / 3 }, weight),
      "Layer 1",
    );
    assertRect(
      placed["layer-3"].cropped,
      { ...FULL, top: (HEIGHT * 2) / 3 },
      "Layer 3's crop",
    );
  });

  it("blends overlapping enters and exits without jumps", () => {
    // Layer 2 exits at 2 s while Layer 3 enters at 1.9 s.
    const at = (seconds: number) =>
      placeAt([
        layer(0, 0, 10, seconds),
        layer(1, 0, 2, seconds),
        layer(2, 1.9, 5, seconds),
      ])["layer-1"].drawn;
    let previous = at(1.8);
    for (let step = 1; step <= 60; step++) {
      const next = at(1.8 + step / 200);
      for (const key of ["left", "right", "top", "bottom"] as const) {
        assert.ok(
          Math.abs(next[key] - previous[key]) < HEIGHT / 20,
          `Layer 1 jumps at ${1.8 + step / 200} s`,
        );
      }
      previous = next;
    }
  });

  it("changes nothing with the animation off", () => {
    for (const seconds of [2, 2 + 1 / FPS, 3, 6 - 1 / FPS]) {
      const layers = [layer(0, 0, 10, seconds), layer(1, 2, 4, seconds)];
      const steps = planLayerDraws(layers, order("vertical", null));
      assert.ok(steps.every((step) => !("motion" in step)));
      const placed = placeAt(layers, order("vertical", null));
      assertRect(placed["layer-1"].drawn, TOP_HALF, `Layer 1 at ${seconds}`);
      assertRect(placed["layer-2"].drawn, BOTTOM_HALF, `Layer 2 at ${seconds}`);
    }
  });

  it("is drawn the same whenever a frame is reached, as export and preview are", () => {
    const seconds = 2 + 3 / FPS;
    const direct = twoLayersAt(seconds);
    // Played through, or sought to from further on.
    for (let frame = 0; frame < 10; frame++) {
      twoLayersAt(2 + frame / FPS);
    }
    twoLayersAt(5);
    assert.deepEqual(twoLayersAt(seconds), direct);
  });
});

describe("resolveOrderSlide", () => {
  const animation = (patch: Partial<EffectAnimation> = {}) => ({
    ...(createDefaultAnimation("Order") as EffectAnimation),
    ...patch,
  });

  it("times Order's slides at 7, 5 and 3 frames", () => {
    for (const [timing, frames] of [
      ["Slow", 7],
      ["Normal", 5],
      ["Fast", 3],
    ] as const) {
      const base = animation();
      assert.deepEqual(
        resolveOrderSlide({ ...base, clip: { ...base.clip, timing } }, 24),
        { motionIn: "Ease Out", motionOut: "Ease In", frames, fps: 24 },
      );
    }
  });

  it("has no slide unless the animation is on in Clip mode", () => {
    assert.equal(resolveOrderSlide(undefined, FPS), undefined);
    assert.equal(
      resolveOrderSlide(animation({ enabled: false }), FPS),
      undefined,
    );
    assert.equal(
      resolveOrderSlide(animation({ mode: "reactive" }), FPS),
      undefined,
    );
  });

  it("gives the Order on a stack its slide", () => {
    const effects = [
      {
        id: "order",
        trackId: "global",
        effectName: "Order",
        parameters: [{ key: "Arrangement", value: "Horizontal" }],
        animation: animation(),
      },
    ];
    assert.deepEqual(findAnimatedOrder(effects, "global", FPS)?.slide, SLIDE);
    assert.equal(
      findAnimatedOrder(
        [{ ...effects[0], animation: animation({ enabled: false }) }],
        "global",
        FPS,
      )?.slide,
      undefined,
    );
  });

  it("weights a slide by the clip's position", () => {
    assert.equal(orderSlideWeight(SLIDE, 0, 4), 0);
    assert.equal(orderSlideWeight(SLIDE, 5 / FPS, 4), 1);
    assert.equal(orderSlideWeight(SLIDE, 2, 4), 1);
    assert.equal(orderSlideWeight(SLIDE, 4, 4), 0);
    assert.equal(
      orderSlideWeight(SLIDE, 2 / FPS, 4),
      easeMotion("Ease Out", 2 / 5),
    );
  });
});

describe("Order spacing and border tween", () => {
  const spacing = (weight: number) =>
    applyClipAnimationWeight(
      {
        effectName: "Order",
        parameters: [
          { key: "Spacing", value: "20", numericValue: 20 },
          { key: "BorderColor", value: "rgba(255,0,100,0.5)" },
        ],
      },
      weight,
    );

  it("tweens Spacing from 0 to its value", () => {
    assert.equal(spacing(0)[0].numericValue, 0);
    assert.equal(spacing(0.25)[0].numericValue, 5);
    assert.equal(spacing(1)[0].numericValue, 20);
  });

  it("tweens the border color from black, linearly in RGBA", () => {
    assert.equal(spacing(0)[1].value, "rgba(0,0,0,1)");
    assert.equal(spacing(0.5)[1].value, "rgba(128,0,50,0.75)");
    assert.equal(spacing(1)[1].value, "rgba(255,0,100,0.5)");
  });
});
