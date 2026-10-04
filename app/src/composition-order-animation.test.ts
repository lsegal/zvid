import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findAnimatedOrder } from "./composition-active-clips.ts";
import {
  type FrameBounds,
  isSlotScissorEmpty,
  type LayerDrawStep,
  planLayerDraws,
  resolveLayerPlacement,
  resolveSlotBounds,
  resolveSlotOpacity,
  resolveSlotScissor,
} from "./composition-layout.ts";
import type { CompositionOrder, OrderSlide } from "./composition-order.ts";
import {
  orderSlideWeight,
  resolveClipAnimatedParameters,
  resolveOrderSlide,
  type SessionEdges,
} from "./fx-animation-clip.ts";
import {
  createDefaultAnimation,
  type EffectAnimation,
  normalizeEffectAnimation,
} from "./fx-animation-defaults.ts";
import { easeMotion } from "./motion-easing.ts";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
// Order's Normal timing, pushed in.
const SLIDE: OrderSlide = { frames: 5, fps: FPS, transition: "Push" };

// How far a clip `progress` of the way through its slide has slid in, or
// how far one with `progress` of its slide left still is: an Order's slides
// always ease in and out.
function ease(progress: number) {
  return easeMotion("Ease In Out", progress);
}

type Layer = {
  id: string;
  laneRank: number;
  clip: {
    startQ: number;
    durationSeconds: number;
    layerClipDurationSeconds?: number;
  };
  clipProgress: number;
  sessionEdges?: SessionEdges;
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
  gridSize = 2,
): CompositionOrder {
  return {
    arrangement,
    gridSize,
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

type Placed = { id: string; drawn: Rect; cropped: Rect; opacity: number };

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
        opacity: resolveSlotOpacity(step.order, step.motion),
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

// `rect` in whole pixels, as a layer is cropped.
function roundRect(rect: Rect): Rect {
  return {
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
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
  it("slides a clip entering the last slot in from the bottom while Layer 1 shrinks to its half", () => {
    for (let frame = 0; frame <= 5; frame++) {
      const placed = twoLayersAt(2 + frame / FPS);
      const weight = ease(frame / 5);
      assertRect(
        placed["layer-1"].drawn,
        lerpRect(FULL, TOP_HALF, weight),
        `Layer 1 at frame ${frame}`,
      );
      assertRect(
        placed["layer-2"].drawn,
        {
          ...BOTTOM_HALF,
          top: HEIGHT / 2 + (HEIGHT / 2) * (1 - weight),
          bottom: HEIGHT + (HEIGHT / 2) * (1 - weight),
        },
        `Layer 2 at frame ${frame}`,
      );
      assert.equal(placed["layer-2"].opacity, 1);
      if (frame > 0) {
        // It is cropped to the gap Layer 1 leaves it all the way in.
        assertRect(
          placed["layer-2"].cropped,
          roundRect({ ...BOTTOM_HALF, top: HEIGHT - (HEIGHT / 2) * weight }),
          `Layer 2's crop at frame ${frame}`,
        );
      }
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

  it("slides a piece of a layer clip in and out with the whole clip", () => {
    // Layer 2's clip plays from 2 s to 6 s, but its source track holds
    // something only until 3 s, so it draws as one piece from 2 s to 3 s.
    // Its progress is through the whole clip, as computeActiveClips gives
    // it, so six frames in it has finished sliding in (#936).
    const seconds = 2 + 6 / FPS;
    const piece: Layer = {
      ...layer(1, 2, 4, seconds),
      clip: { startQ: 2, durationSeconds: 1, layerClipDurationSeconds: 4 },
    };
    const steps = planLayerDraws(
      [layer(0, 0, 10, seconds), piece],
      order("vertical"),
    );
    assert.ok(steps.every((step) => !("motion" in step)));
  });

  it("plays the enter backwards when a clip exits", () => {
    for (let frame = 0; frame <= 5; frame++) {
      const entering = twoLayersAt(2 + frame / FPS);
      const exiting = twoLayersAt(6 - frame / FPS);
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
  });

  // Clips on layers 1 to 3 that play throughout, but for `moving`, which
  // enters at 2 s (or exits at 6 s) `frame` frames into its slide.
  const threeAt = (
    arrangement: CompositionOrder,
    moving: number,
    frame: number,
    exit = false,
  ) => {
    const seconds = exit ? 6 - frame / FPS : 2 + frame / FPS;
    return placeAt(
      [0, 1, 2].map((rank) =>
        rank === moving
          ? layer(rank, 2, 4, seconds)
          : layer(rank, 0, 10, seconds),
      ),
      arrangement,
    );
  };

  for (const arrangement of ["horizontal", "vertical"] as const) {
    const size = arrangement === "horizontal" ? WIDTH : HEIGHT;
    const [start, end] =
      arrangement === "horizontal" ? ["left", "right"] : ["top", "bottom"];
    const span = (from: number, to: number): Rect =>
      arrangement === "horizontal"
        ? { left: from, right: to, top: 0, bottom: HEIGHT }
        : { left: 0, right: WIDTH, top: from, bottom: to };

    for (const exit of [false, true]) {
      const verb = exit ? "exits" : "enters";
      const toward = exit ? "out to" : "in from";

      it(`slides a ${arrangement} Order's first clip ${toward} the ${start} edge as it ${verb}, pushing the others`, () => {
        for (let frame = 1; frame <= 5; frame++) {
          const weight = ease(frame / 5);
          const placed = threeAt(order(arrangement), 0, frame, exit);
          const off = (size / 3) * (1 - weight);
          assertRect(
            placed["layer-1"].drawn,
            span(-off, size / 3 - off),
            `Layer 1 at frame ${frame}`,
          );
          assertRect(
            placed["layer-1"].cropped,
            roundRect(span(0, (size / 3) * weight)),
            `Layer 1's crop at frame ${frame}`,
          );
          assertRect(
            placed["layer-2"].drawn,
            lerpRect(span(0, size / 2), span(size / 3, (size * 2) / 3), weight),
            `Layer 2 at frame ${frame}`,
          );
          assert.equal(placed["layer-1"].opacity, 1);
        }
      });

      it(`slides a ${arrangement} Order's last clip ${toward} the ${end} edge as it ${verb}`, () => {
        for (let frame = 1; frame <= 5; frame++) {
          const weight = ease(frame / 5);
          const placed = threeAt(order(arrangement), 2, frame, exit);
          const off = (size / 3) * (1 - weight);
          assertRect(
            placed["layer-3"].drawn,
            span((size * 2) / 3 + off, size + off),
            `Layer 3 at frame ${frame}`,
          );
          assertRect(
            placed["layer-3"].cropped,
            roundRect(span(size - (size / 3) * weight, size)),
            `Layer 3's crop at frame ${frame}`,
          );
          assertRect(
            placed["layer-2"].drawn,
            lerpRect(
              span(size / 2, size),
              span(size / 3, (size * 2) / 3),
              weight,
            ),
            `Layer 2 at frame ${frame}`,
          );
        }
      });

      it(`fades a ${arrangement} Order's middle clip ${exit ? "out" : "in"} in its slot as it ${verb}, its neighbors ${exit ? "closing in" : "pushed apart"}`, () => {
        for (let frame = 1; frame <= 5; frame++) {
          const weight = ease(frame / 5);
          const placed = threeAt(order(arrangement), 1, frame, exit);
          const gap = span(
            size / 2 - (size / 6) * weight,
            size / 2 + (size / 6) * weight,
          );
          assertRect(
            placed["layer-2"].drawn,
            span(size / 3, (size * 2) / 3),
            `Layer 2 at frame ${frame}`,
          );
          assertRect(
            placed["layer-2"].cropped,
            roundRect(gap),
            `Layer 2's crop at frame ${frame}`,
          );
          assert.ok(
            Math.abs(placed["layer-2"].opacity - weight) < 1e-9,
            `Layer 2's opacity at frame ${frame}`,
          );
          assertRect(
            placed["layer-1"].drawn,
            span(0, gap[start as keyof Rect]),
            `Layer 1 at frame ${frame}`,
          );
          assertRect(
            placed["layer-3"].drawn,
            span(gap[end as keyof Rect], size),
            `Layer 3 at frame ${frame}`,
          );
        }
      });
    }
  }

  // Nine clips filling a 3×3 Grid, but for `moving`, which enters at 2 s,
  // two frames into its slide.
  const gridAt = (moving: number) => {
    const seconds = 2 + 2 / FPS;
    return placeAt(
      Array.from({ length: 9 }, (_, rank) =>
        rank === moving
          ? layer(rank, 2, 4, seconds)
          : layer(rank, 0, 10, seconds),
      ),
      order("grid", SLIDE, 3),
    )[`layer-${moving + 1}`];
  };
  const cell = (index: number): Rect => ({
    left: ((index % 3) * WIDTH) / 3,
    right: (((index % 3) + 1) * WIDTH) / 3,
    top: (Math.floor(index / 3) * HEIGHT) / 3,
    bottom: ((Math.floor(index / 3) + 1) * HEIGHT) / 3,
  });
  const shift = (rect: Rect, dx: number, dy: number): Rect => ({
    left: rect.left + dx,
    right: rect.right + dx,
    top: rect.top + dy,
    bottom: rect.bottom + dy,
  });

  it("slides a Grid clip in from its column's edge, else its row's", () => {
    const off = 1 - ease(2 / 5);
    // The first and last columns slide in from the left and right.
    assertRect(gridAt(0).drawn, shift(cell(0), (-WIDTH / 3) * off, 0), "left");
    assertRect(gridAt(6).drawn, shift(cell(6), (-WIDTH / 3) * off, 0), "left");
    assertRect(gridAt(2).drawn, shift(cell(2), (WIDTH / 3) * off, 0), "right");
    // The middle column slides in from the top or bottom row's edge.
    assertRect(gridAt(1).drawn, shift(cell(1), 0, (-HEIGHT / 3) * off), "top");
    assertRect(
      gridAt(7).drawn,
      shift(cell(7), 0, (HEIGHT / 3) * off),
      "bottom",
    );
    for (const index of [0, 1, 2, 6, 7]) {
      assert.equal(gridAt(index).opacity, 1);
    }
  });

  it("fades a clip into an interior Grid cell", () => {
    const placed = gridAt(4);
    assertRect(placed.drawn, cell(4), "drawn");
    assert.ok(Math.abs(placed.opacity - ease(2 / 5)) < 1e-9);
  });

  it("moves clips that enter together as one", () => {
    const seconds = 2 + 3 / FPS;
    const weight = ease(3 / 5);
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
    // Both enter from the bottom, into the gap Layer 1 leaves them.
    assertRect(
      placed["layer-3"].cropped,
      roundRect({ ...FULL, top: HEIGHT - (HEIGHT / 3) * weight }),
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

  it("doesn't slide or re-flow for clips at frame 0", () => {
    // Both clips start the session; Layer 2's ends mid-session.
    const at = (seconds: number) => {
      const layers = [layer(0, 0, 10, seconds), layer(1, 0, 4, seconds)];
      layers[0].sessionEdges = { atStart: true, atEnd: true };
      layers[1].sessionEdges = { atStart: true, atEnd: false };
      return layers;
    };
    const steps = planLayerDraws(at(0), order("vertical"));
    assert.ok(steps.every((step) => !("motion" in step)));
    const placed = placeAt(at(0));
    assertRect(placed["layer-1"].drawn, TOP_HALF, "Layer 1");
    assertRect(placed["layer-2"].drawn, BOTTOM_HALF, "Layer 2");
    // Layer 2 still slides out as its clip ends, and Layer 1 re-flows.
    const exiting = placeAt(at(4 - 2 / FPS));
    assertRect(
      exiting["layer-1"].drawn,
      lerpRect(FULL, TOP_HALF, ease(2 / 5)),
      "Layer 1 as Layer 2 exits",
    );
  });

  it("doesn't slide a clip out on the session's last frame", () => {
    const layers = [
      layer(0, 0, 10, 10 - 1 / FPS),
      layer(1, 2, 8, 10 - 1 / FPS),
    ];
    layers[0].sessionEdges = { atStart: true, atEnd: true };
    layers[1].sessionEdges = { atStart: false, atEnd: true };
    const steps = planLayerDraws(layers, order("vertical"));
    assert.ok(steps.every((step) => !("motion" in step)));
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
        { frames, fps: 24, transition: "Squish" },
      );
    }
  });

  it("ignores Motion In and Out, which an Order no longer has", () => {
    const base = animation();
    for (const motion of ["None", "Linear", "Ease In"] as const) {
      const saved = {
        ...base,
        clip: { ...base.clip, motionIn: motion, motionOut: motion },
      };
      assert.deepEqual(
        resolveOrderSlide(saved, FPS),
        resolveOrderSlide(base, FPS),
      );
    }
  });

  it("has no Full timing", () => {
    const base = animation();
    const saved = { ...base, clip: { ...base.clip, timing: "Full" } };
    assert.equal(
      normalizeEffectAnimation(saved, "Order")?.clip.timing,
      base.clip.timing,
    );
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
    assert.deepEqual(findAnimatedOrder(effects, "global", FPS)?.slide, {
      ...SLIDE,
      transition: "Squish",
    });
    assert.equal(
      findAnimatedOrder(
        [{ ...effects[0], animation: animation({ enabled: false }) }],
        "global",
        FPS,
      )?.slide,
      undefined,
    );
  });

  it("doesn't slide in at the session start or out at its end", () => {
    const edges = { atStart: true, atEnd: true };
    assert.equal(orderSlideWeight(SLIDE, 0, 4, edges), 1);
    assert.equal(orderSlideWeight(SLIDE, 4, 4, edges), 1);
    const atStart = { atStart: true, atEnd: false };
    assert.equal(orderSlideWeight(SLIDE, 0, 4, atStart), 1);
    assert.equal(orderSlideWeight(SLIDE, 4, 4, atStart), 0);
  });

  it("weights a slide by the clip's position", () => {
    assert.equal(orderSlideWeight(SLIDE, 0, 4), 0);
    assert.equal(orderSlideWeight(SLIDE, 5 / FPS, 4), 1);
    assert.equal(orderSlideWeight(SLIDE, 2, 4), 1);
    assert.equal(orderSlideWeight(SLIDE, 4, 4), 0);
    assert.equal(orderSlideWeight(SLIDE, 2 / FPS, 4), ease(2 / 5));
  });

  it("only slides at the ends of a clip the Order's clip is active for", () => {
    const within = (elapsedSeconds: number, remainingSeconds: number) => ({
      ...SLIDE,
      window: { elapsedSeconds, remainingSeconds },
    });
    // A clip that started with the Order, or before it, doesn't slide in.
    assert.equal(orderSlideWeight(within(0, 4), 0, 8), 1);
    assert.equal(orderSlideWeight(within(1 / FPS, 4), 2 / FPS, 8), 1);
    // A clip that ends with the Order, or after it, doesn't slide out.
    assert.equal(orderSlideWeight(within(4, 1 / FPS), 4 - 1 / FPS, 4), 1);
    assert.equal(orderSlideWeight(within(4, 1 / FPS), 4 - 2 / FPS, 4), 1);
    // A clip that starts and ends while the Order is active slides both
    // ways.
    assert.equal(orderSlideWeight(within(1, 4), 0, 1), 0);
    assert.equal(orderSlideWeight(within(1, 4), 2 / FPS, 1), ease(2 / 5));
    assert.ok(
      Math.abs(orderSlideWeight(within(1, 4), 1 - 2 / FPS, 1) - ease(2 / 5)) <
        1e-9,
    );
  });

  it("gives an FX clip's Order the clip's window", () => {
    const window = { elapsedSeconds: 1, remainingSeconds: 2 };
    const effects = [
      {
        id: "order",
        trackId: "fx",
        effectName: "Order",
        parameters: [],
        animation: animation(),
      },
    ];
    assert.deepEqual(
      findAnimatedOrder(effects, "fx", FPS, window)?.slide?.window,
      window,
    );
  });
});

describe("Order's own clip", () => {
  it("doesn't tween its spacing, margin or border at its start or end", () => {
    const parameters = [
      { key: "Spacing", value: "20", numericValue: 20 },
      { key: "Margin", value: "10", numericValue: 10 },
      { key: "BorderColor", value: "rgba(255,0,100,0.5)" },
    ];
    const effect = {
      id: "order",
      trackId: "fx",
      effectName: "Order",
      parameters,
      animation: createDefaultAnimation("Order") as EffectAnimation,
    };
    effect.animation.enabled = true;
    for (const elapsedSeconds of [0, 1 / FPS, 2, 4 - 1 / FPS, 4]) {
      assert.equal(
        resolveClipAnimatedParameters(
          effect,
          {
            clipId: "clip",
            laneId: "lane",
            progress: elapsedSeconds / 4,
            elapsedSeconds,
            durationSeconds: 4,
          },
          { playheadQ: 0, bpm: 120, fps: FPS },
        ),
        parameters,
        `at ${elapsedSeconds} s`,
      );
    }
  });
});

describe("Order Squish transition", () => {
  // 4 frames, so a slide is `ease(t)` of the way in 4t frames in, which is
  // `t` at each of `T`.
  const SQUISH: OrderSlide = { frames: 4, fps: FPS, transition: "Squish" };
  const T = [0, 0.5, 1];
  // Clips on layers 1 to 3 that play throughout, but for `moving`, which
  // enters at 2 s (or exits at 6 s), `t` of the way in.
  const threeAt = (
    arrangement: "horizontal" | "vertical",
    moving: number,
    t: number,
    exit = false,
  ) => {
    const seconds = exit ? 6 - (4 * t) / FPS : 2 + (4 * t) / FPS;
    return placeAt(
      [0, 1, 2].map((rank) =>
        rank === moving
          ? layer(rank, 2, 4, seconds)
          : layer(rank, 0, 10, seconds),
      ),
      order(arrangement, SQUISH),
    );
  };
  // `start`..`end` along the arrangement's axis, across the whole canvas.
  const span = (
    arrangement: "horizontal" | "vertical",
    start: number,
    end: number,
  ): Rect =>
    arrangement === "horizontal"
      ? { left: start, right: end, top: 0, bottom: HEIGHT }
      : { left: 0, right: WIDTH, top: start, bottom: end };

  for (const arrangement of ["horizontal", "vertical"] as const) {
    const size = arrangement === "horizontal" ? WIDTH : HEIGHT;
    const [start, end] =
      arrangement === "horizontal" ? ["left", "right"] : ["top", "bottom"];

    it(`grows a ${arrangement} Order's first clip from the ${start} edge, pushing the others on`, () => {
      for (const t of T) {
        const placed = threeAt(arrangement, 0, t);
        assertRect(
          placed["layer-1"].drawn,
          span(arrangement, 0, (size / 3) * t),
          `Layer 1 at ${t}`,
        );
        assertRect(
          placed["layer-2"].drawn,
          lerpRect(
            span(arrangement, 0, size / 2),
            span(arrangement, size / 3, (size * 2) / 3),
            t,
          ),
          `Layer 2 at ${t}`,
        );
        assertRect(
          placed["layer-3"].drawn,
          lerpRect(
            span(arrangement, size / 2, size),
            span(arrangement, (size * 2) / 3, size),
            t,
          ),
          `Layer 3 at ${t}`,
        );
      }
    });

    it(`grows a ${arrangement} Order's last clip from the ${end} edge`, () => {
      for (const t of T) {
        const placed = threeAt(arrangement, 2, t);
        assertRect(
          placed["layer-3"].drawn,
          span(arrangement, size - (size / 3) * t, size),
          `Layer 3 at ${t}`,
        );
        assertRect(
          placed["layer-1"].drawn,
          lerpRect(
            span(arrangement, 0, size / 2),
            span(arrangement, 0, size / 3),
            t,
          ),
          `Layer 1 at ${t}`,
        );
      }
    });

    it(`grows a ${arrangement} Order's middle clip from its center, pushing its neighbors apart`, () => {
      for (const t of T) {
        const placed = threeAt(arrangement, 1, t);
        const middle = span(
          arrangement,
          size / 2 - (size / 6) * t,
          size / 2 + (size / 6) * t,
        );
        assertRect(placed["layer-2"].drawn, middle, `Layer 2 at ${t}`);
        // Its neighbors end and start exactly where it does.
        assertRect(
          placed["layer-1"].drawn,
          span(arrangement, 0, size / 2 - (size / 6) * t),
          `Layer 1 at ${t}`,
        );
        assertRect(
          placed["layer-3"].drawn,
          span(arrangement, size / 2 + (size / 6) * t, size),
          `Layer 3 at ${t}`,
        );
        if (t > 0) {
          // Cropped to the squished box, not its whole slot.
          assertRect(
            placed["layer-2"].cropped,
            middle,
            `Layer 2's crop at ${t}`,
          );
        }
      }
    });

    it(`collapses a ${arrangement} Order's exiting middle clip to its center`, () => {
      for (const t of T) {
        const exiting = threeAt(arrangement, 1, t, true);
        const entering = threeAt(arrangement, 1, t);
        for (const id of ["layer-1", "layer-2", "layer-3"]) {
          assertRect(exiting[id].drawn, entering[id].drawn, `${id} at ${t}`);
        }
      }
      assertRect(
        threeAt(arrangement, 1, 0, true)["layer-2"].drawn,
        span(arrangement, size / 2, size / 2),
        "Layer 2 once out",
      );
    });
  }

  // Whether each layer's clip is drawn at all, by id.
  const shownAt = (layers: Layer[], arrangement: CompositionOrder) =>
    Object.fromEntries(
      planLayerDraws(layers, arrangement).flatMap((step) =>
        step.type === "layer"
          ? [
              [
                step.entry.id,
                !isSlotScissorEmpty(
                  step.slot,
                  step.slotCount,
                  step.order,
                  WIDTH,
                  HEIGHT,
                  step.motion,
                ),
              ],
            ]
          : [],
      ),
    );

  it("draws nothing of a clip squished to zero width or height", () => {
    for (const arrangement of ["horizontal", "vertical", "grid"] as const) {
      for (const moving of [0, 1, 2]) {
        for (const exit of [false, true]) {
          const seconds = exit ? 6 : 2;
          const layers = [0, 1, 2].map((rank) =>
            rank === moving
              ? layer(rank, 2, 4, seconds)
              : layer(rank, 0, 10, seconds),
          );
          const label = `${arrangement} Layer ${moving + 1} ${exit ? "out" : "in"}`;
          const shown = shownAt(layers, order(arrangement, SQUISH));
          assert.deepEqual(
            shown,
            Object.fromEntries(
              [0, 1, 2].map((rank) => [`layer-${rank + 1}`, rank !== moving]),
            ),
            label,
          );
          // A frame on, it is drawn in its sliver of the slot.
          const later = [0, 1, 2].map((rank) =>
            rank === moving
              ? layer(rank, 2, 4, seconds + (exit ? -1 : 1) / FPS)
              : layer(rank, 0, 10, seconds + (exit ? -1 : 1) / FPS),
          );
          assert.ok(
            shownAt(later, order(arrangement, SQUISH))[`layer-${moving + 1}`],
            `${label} a frame on`,
          );
          // Pushed rather than squished, it is cropped to the same gap.
          assert.deepEqual(
            shownAt(layers, order(arrangement, SLIDE)),
            shown,
            `${label} pushed`,
          );
        }
      }
    }
  });

  it("grows a clip into the gap between uneven neighbors without overlap", () => {
    // Layer 2 of 4 enters between Layer 1 and Layer 3.
    const seconds = 2 + 1 / FPS;
    const placed = placeAt(
      [0, 1, 2, 3].map((rank) =>
        rank === 1 ? layer(rank, 2, 4, seconds) : layer(rank, 0, 10, seconds),
      ),
      order("horizontal", SQUISH),
    );
    assert.ok(
      Math.abs(placed["layer-1"].drawn.right - placed["layer-2"].drawn.left) <
        1e-6,
    );
    assert.ok(
      Math.abs(placed["layer-2"].drawn.right - placed["layer-3"].drawn.left) <
        1e-6,
    );
  });

  it("squishes a Grid clip from its column's edge, else its row's", () => {
    const seconds = 2 + 2 / FPS;
    const grid = (entering: number, count: number) =>
      placeAt(
        Array.from({ length: count }, (_, rank) =>
          rank === entering
            ? layer(rank, 2, 4, seconds)
            : layer(rank, 0, 10, seconds),
        ),
        order("grid", SQUISH),
      );
    // Layer 2 enters the top-right cell from its right edge.
    assertRect(
      grid(1, 4)["layer-2"].drawn,
      { left: (WIDTH * 3) / 4, right: WIDTH, top: 0, bottom: HEIGHT / 2 },
      "Layer 2 beside Layer 1",
    );
    // Layer 1 enters the top-left cell from its left edge.
    assertRect(
      grid(0, 4)["layer-1"].drawn,
      { left: 0, right: WIDTH / 4, top: 0, bottom: HEIGHT / 2 },
      "Layer 1 beside Layer 2",
    );
    // Layer 3 enters the bottom-left cell from its left edge.
    assertRect(
      grid(2, 3)["layer-3"].drawn,
      { left: 0, right: WIDTH / 4, top: HEIGHT / 2, bottom: HEIGHT },
      "Layer 3 in the first column",
    );
    // A clip alone in the grid scales in about its cell's center.
    assertRect(
      grid(0, 1)["layer-1"].drawn,
      {
        left: WIDTH / 8,
        right: (WIDTH * 3) / 8,
        top: HEIGHT / 8,
        bottom: (HEIGHT * 3) / 8,
      },
      "Layer 1 alone",
    );
  });

  it("cover-fits a squishing clip's content rather than stretching it", () => {
    const seconds = 2 + 2 / FPS;
    const [step] = planLayerDraws(
      [
        layer(0, 2, 4, seconds),
        layer(1, 0, 10, seconds),
        layer(2, 0, 10, seconds),
      ],
      order("horizontal", SQUISH),
    );
    assert.ok(step.type === "layer" && step.motion);
    const placement = resolveLayerPlacement({
      index: step.slot,
      count: step.slotCount,
      canvasWidth: WIDTH,
      canvasHeight: HEIGHT,
      sourceWidth: 1920,
      sourceHeight: 1080,
      visual: {
        scale: 1,
        translateX: 0,
        translateY: 0,
        layoutAnchor: "center",
      },
      order: step.order,
      motion: step.motion,
    });
    // Drawn in the squished box, half its slot's width...
    assertRect(
      toRect(placement.frame),
      { left: 0, right: WIDTH / 6, top: 0, bottom: HEIGHT },
      "frame",
    );
    // ...at the source's own aspect, covering it.
    const { x, y } = placement.halfExtents;
    assert.ok(Math.abs((x * WIDTH) / (y * HEIGHT) - 16 / 9) < 1e-9);
    assert.ok(x >= placement.frame.halfWidth - 1e-9);
    assert.ok(y >= placement.frame.halfHeight - 1e-9);
  });

  it("pushes exactly as before without a transition", () => {
    const { transition: _transition, ...legacy } = SLIDE;
    for (const arrangement of ["vertical", "horizontal", "grid"] as const) {
      for (let frame = 0; frame <= 5; frame++) {
        const layers = [0, 1, 2].map((rank) =>
          rank === 1
            ? layer(rank, 2, 4, 2 + frame / FPS)
            : layer(rank, 0, 10, 2 + frame / FPS),
        );
        assert.deepEqual(
          placeAt(layers, order(arrangement, legacy)),
          placeAt(layers, order(arrangement, SLIDE)),
        );
      }
    }
  });
});

describe("Order Transition setting", () => {
  it("defaults new Orders to Squish", () => {
    assert.equal(createDefaultAnimation("Order")?.clip.transition, "Squish");
  });

  it("keeps Push for Orders saved before Transition", () => {
    const saved = {
      enabled: true,
      mode: "clip",
      clip: { motionIn: "Ease Out", motionOut: "Ease In", timing: "Normal" },
    };
    assert.equal(
      normalizeEffectAnimation(saved, "Order")?.clip.transition,
      "Push",
    );
    assert.equal(
      normalizeEffectAnimation(
        { ...saved, clip: { ...saved.clip, transition: "squish" } },
        "Order",
      )?.clip.transition,
      "Squish",
    );
  });

  it("gives no other effect a Transition", () => {
    assert.equal(
      createDefaultAnimation("Transform")?.clip.transition,
      undefined,
    );
    assert.equal(
      "transition" in
        (normalizeEffectAnimation({ enabled: true, clip: {} }, "Transform")
          ?.clip ?? {}),
      false,
    );
  });
});
