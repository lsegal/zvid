import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ArrangementClip,
  computeActiveClips,
  type MediaItem,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { computeActiveClipTimings } from "./composition-clip-timing.ts";
import { indexEffects } from "./composition-effect-index.ts";
import {
  type LayerDrawStep,
  planLayerDraws,
  type TransitionComps,
} from "./composition-layout.ts";
import {
  type CompositionOrder,
  Z_ORDER_COMPOSITION,
} from "./composition-order.ts";
import { findTransitionClips } from "./composition-transition.ts";
import { createEffect } from "./fx/stack/ops.ts";
import { clipEffectTrackId } from "./fx-stack.ts";
import { mediaWindowAt } from "./media-window.ts";

// 60 BPM, so a quarter note is a second.
const BPM = 60;
const FPS = 30;

describe("planLayerDraws with a Transition", () => {
  const horizontal: CompositionOrder = {
    arrangement: "horizontal",
    gridSize: 2,
    spacing: 0,
  };
  type Layer = {
    id: string;
    laneRank: number;
    clip: { id: string; startQ: number; laneId: string };
    fx: boolean;
    held?: boolean;
    order?: CompositionOrder;
    transition?: TransitionComps;
  };
  const layer = (
    id: string,
    lane: number,
    extra: Partial<Layer> = {},
  ): Layer => ({
    id,
    laneRank: lane - 1,
    clip: { id, startQ: 0, laneId: `${lane}` },
    fx: false,
    ...extra,
  });
  const describeSteps = (steps: LayerDrawStep<Layer>[]): string[] =>
    steps.map((step) =>
      step.type === "arrange"
        ? `${step.entry.id}[${describeSteps(step.steps).join(" ")}]`
        : step.type === "transition"
          ? `${step.entry.id}<${describeSteps(step.outgoing).join(" ")} > ${describeSteps(step.incoming).join(" ")}>`
          : step.type === "fx"
            ? step.entry.id
            : step.order.arrangement === "none"
              ? `${step.entry.id}@full`
              : `${step.entry.id}@${step.slot}/${step.slotCount}`,
    );

  // An Order on Layer 2 arranges the clips on Layers 3–5, which have ended,
  // and the next clip has come in on Layer 3.
  const orderThenNext = (transition: TransitionComps) => [
    layer("transition", 1, { fx: true, transition }),
    layer("order", 2, { fx: true, order: horizontal, held: true }),
    layer("a3", 3, { held: true }),
    layer("a4", 4, { held: true }),
    layer("a5", 5, { held: true }),
    layer("next", 3),
  ];

  it("transitions from an Order's group of three to the next clip as two comps", () => {
    const steps = planLayerDraws(
      orderThenNext({
        outgoing: new Set(["order", "a3", "a4", "a5"]),
        incoming: new Set(["next"]),
      }),
      Z_ORDER_COMPOSITION,
    );
    assert.equal(steps.length, 1);
    const [step] = steps;
    assert.equal(step.type, "transition");
    assert.deepEqual(describeSteps(steps), [
      "transition<order[a3@0/3 a4@1/3 a5@2/3] > next@full>",
    ]);
  });

  it("puts a clip that came in during the Transition in comp B", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws(
          orderThenNext({
            outgoing: new Set(["order", "a3", "a4", "a5"]),
            incoming: new Set(),
          }),
          Z_ORDER_COMPOSITION,
        ),
      ),
      ["transition<order[a3@0/3 a4@1/3 a5@2/3] > next@full>"],
    );
  });

  it("draws a clip in both comps while it lasts through the Transition", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws(
          [
            layer("transition", 1, {
              fx: true,
              transition: {
                outgoing: new Set(["background", "a"]),
                incoming: new Set(["background", "b"]),
              },
            }),
            layer("a", 2, { held: true }),
            layer("b", 2),
            layer("background", 3),
          ],
          Z_ORDER_COMPOSITION,
        ),
      ),
      ["transition<background@full a@full > background@full b@full>"],
    );
  });

  it("arranges each comp by the Global Order on its own", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws(
          [
            layer("transition", 1, {
              fx: true,
              transition: {
                outgoing: new Set(["a2", "a3"]),
                incoming: new Set(["b2"]),
              },
            }),
            layer("a2", 2, { held: true }),
            layer("a3", 3),
            layer("b2", 2),
          ],
          horizontal,
        ),
      ),
      ["transition<a2@0/2 a3@1/2 > b2@0/1>"],
    );
  });

  it("keeps the slots of the layers above it without the held clips", () => {
    assert.deepEqual(
      describeSteps(
        planLayerDraws(
          [
            layer("title", 1),
            layer("transition", 2, {
              fx: true,
              transition: {
                outgoing: new Set(["a"]),
                incoming: new Set(["b"]),
              },
            }),
            layer("a", 3, { held: true }),
            layer("b", 3),
          ],
          horizontal,
        ),
      ),
      ["transition<a@0/1 > b@0/1>", "title@0/2"],
    );
  });
});

function media(id: string): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    kind: "video",
    durationSeconds: 10,
    width: 320,
    height: 180,
    hasAudio: false,
    hasVideo: true,
    previewUrl: `/${id}`,
  };
}

function clip(
  id: string,
  laneId: string,
  startSeconds: number,
  durationSeconds: number,
  kind?: ArrangementClip["kind"],
): ArrangementClip {
  return {
    id,
    ...(kind ? { kind } : {}),
    sourceTrackId: id,
    laneId,
    label: id,
    mediaPath: kind ? "" : `${id}.mp4`,
    ...(kind ? {} : { mediaId: id }),
    startQ: startSeconds,
    durationSeconds,
    trimStartSeconds: 0,
    // Each clip plays its media from the start.
    sourceOffsetSeconds: -startSeconds,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: durationSeconds,
    tint: "#000",
    accent: "#fff",
  };
}

describe("a Transition's held clips", () => {
  // A cut at 4 s on Layer 2 from "out" to "in", under a Transition on
  // Layer 1 from 3 s to 5 s.
  const transition = clip("transition", "1", 3, 2, "fx");
  const outgoing = clip("out", "2", 0, 4);
  const incoming = clip("in", "2", 4, 4);
  const clips = [transition, outgoing, incoming];
  const mediaById = new Map([
    ["out", media("out")],
    ["in", media("in")],
  ]);
  const lanePriority = new Map([
    ["1", 0],
    ["2", 1],
  ]);
  const timingsAt = (seconds: number) =>
    computeActiveClipTimings(clips, mediaById, seconds, BPM, lanePriority, [
      transition,
    ]);

  it("holds the incoming clip on its first frame before the cut", () => {
    const held = timingsAt(3.5).filter((timing) => timing.held);
    assert.deepEqual(
      held.map((timing) => [
        timing.clip.id,
        timing.mediaTime,
        timing.sourceKey,
      ]),
      [["in", 0, "in@held/in"]],
    );
  });

  it("holds the outgoing clip on its last frame after the cut", () => {
    const [held] = timingsAt(4.5).filter((timing) => timing.held);
    assert.equal(held.clip.id, "out");
    assert.ok(Math.abs(held.mediaTime - 3.999) < 1e-9);
    assert.equal(held.isInBounds, true);
  });

  it("holds nothing outside the Transition, or without one", () => {
    assert.deepEqual(
      timingsAt(2).map((timing) => timing.clip.id),
      ["out"],
    );
    assert.deepEqual(
      timingsAt(6).map((timing) => timing.clip.id),
      ["in"],
    );
    assert.ok(
      computeActiveClipTimings(clips, mediaById, 3.5, BPM, lanePriority).every(
        (timing) => !timing.held,
      ),
    );
  });

  it("keeps the held clip's media loaded", () => {
    const window = mediaWindowAt(
      clips,
      mediaById,
      4.5,
      BPM,
      () => true,
      timingsAt(4.5),
    );
    assert.equal(window.get("out"), "auto");
  });

  const transitionEffect = (
    parameters: Record<string, string>,
    animation?: SessionEffect["animation"],
  ): SessionEffect => {
    const effect = createEffect(clipEffectTrackId(transition.id), "Transition");
    return {
      ...effect,
      parameters: effect.parameters.map((parameter) =>
        parameter.key in parameters
          ? { key: parameter.key, value: parameters[parameter.key] }
          : parameter,
      ),
      ...(animation ? { animation } : {}),
    };
  };

  it("finds the FX clips with an enabled Transition", () => {
    const effect = transitionEffect({});
    assert.deepEqual(
      findTransitionClips(clips, indexEffects([effect])).map(({ id }) => id),
      ["transition"],
    );
    assert.deepEqual(
      findTransitionClips(clips, indexEffects([{ ...effect, enabled: false }])),
      [],
    );
  });

  it("gives the FX clip its comps, type and progress", () => {
    const effect = transitionEffect({ Type: "Push", Direction: "Up" });
    const at = (seconds: number) =>
      computeActiveClips(
        clips,
        mediaById,
        seconds,
        BPM,
        lanePriority,
        [effect],
        FPS,
      );
    const frame = at(4);
    const fx = frame.find((entry) => entry.clip.id === "transition");
    assert.deepEqual(
      {
        type: fx?.transition?.type,
        direction: fx?.transition?.direction,
        outgoing: [...(fx?.transition?.outgoing ?? [])],
        incoming: [...(fx?.transition?.incoming ?? [])],
      },
      { type: "Push", direction: [0, 1], outgoing: ["out"], incoming: ["in"] },
    );
    // Full spans the clip: halfway at the cut, eased in and out.
    assert.equal(fx?.transition?.progress, 0.5);
    const at3 = at(3).find((entry) => entry.clip.id === "transition");
    assert.equal(at3?.transition?.progress, 0);
    assert.deepEqual(
      frame.filter((entry) => entry.held).map((entry) => entry.clip.id),
      ["out"],
    );
  });

  it("blends over its Timing, centered in the clip", () => {
    const effect = transitionEffect(
      {},
      {
        enabled: true,
        mode: "clip",
        // 10 frames at 30 fps: a third of a second around the cut.
        clip: { motionIn: "Linear", motionOut: "Linear", timing: "Fast" },
      },
    );
    const progressAt = (seconds: number) =>
      computeActiveClips(
        clips,
        mediaById,
        seconds,
        BPM,
        lanePriority,
        [effect],
        FPS,
      ).find((entry) => entry.clip.id === "transition")?.transition?.progress;
    assert.equal(progressAt(3.5), 0);
    assert.ok(Math.abs((progressAt(4 + 1 / 12) ?? 0) - 0.75) < 1e-9);
    assert.equal(progressAt(4.5), 1);
  });
});
