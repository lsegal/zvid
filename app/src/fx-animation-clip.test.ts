import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ArrangementClip,
  computeActiveClips,
  GROUP_TRACK_ID,
  resolveFrameEffects,
  type SessionEffect,
} from "./composition-active-clips.ts";
import { resolveAnimatedParameters } from "./fx-animation.ts";
import {
  applyClipAnimationWeight,
  clipAnimationWeight,
  fadeCssColors,
} from "./fx-animation-clip.ts";
import {
  type ClipAnimation,
  createDefaultAnimation,
  type EffectAnimation,
  getClipTimingFrames,
} from "./fx-animation-defaults.ts";
import { resolveEffectChain } from "./fx-shaders/registry.ts";
import { easeMotion } from "./motion-easing.ts";

const FPS = 30;
const BPM = 120;

function assertClose(actual: number, expected: number, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
}

const EASE: Pick<ClipAnimation, "motionIn" | "motionOut"> = {
  motionIn: "Ease Out",
  motionOut: "Ease In",
};

// The weight `frame` frames into a clip `length` frames long.
function weightAt(
  frame: number,
  length: number,
  animation = EASE,
  frames = 8,
  fps = FPS,
) {
  return clipAnimationWeight(animation, frames, fps, frame / fps, length / fps);
}

describe("clipAnimationWeight", () => {
  it("animates in over the timing, holds, then animates out", () => {
    assert.equal(weightAt(0, 60), 0);
    assertClose(weightAt(4, 60), easeMotion("Ease Out", 0.5));
    assert.equal(weightAt(8, 60), 1);
    assert.equal(weightAt(30, 60), 1);
    assert.equal(weightAt(52, 60), 1);
    assertClose(weightAt(56, 60), easeMotion("Ease In", 0.5));
    assert.equal(weightAt(60, 60), 0);
  });

  it("follows each side's own curve", () => {
    const linear = { motionIn: "Linear", motionOut: "Ease In Out" } as const;
    assertClose(weightAt(2, 60, linear), 0.25);
    assertClose(weightAt(58, 60, linear), easeMotion("Ease In Out", 0.25));
  });

  it("is immediate on a side with None", () => {
    const none = { motionIn: "None", motionOut: "None" } as const;
    assert.equal(weightAt(0, 60, none), 1);
    assert.equal(weightAt(60, 60, none), 1);

    const outOnly = { motionIn: "None", motionOut: "Linear" } as const;
    assert.equal(weightAt(0, 60, outOnly), 1);
    assertClose(weightAt(56, 60, outOnly), 0.5);
  });

  it("halves each side on a clip too short for both", () => {
    // 10 frames with 8-frame sides: each side takes 5.
    assert.equal(weightAt(0, 10), 0);
    assertClose(weightAt(2.5, 10), easeMotion("Ease Out", 0.5));
    assert.equal(weightAt(5, 10), 1);
    assertClose(weightAt(7.5, 10), easeMotion("Ease In", 0.5));
    assert.equal(weightAt(10, 10), 0);
  });

  it("counts the timing in frames at the session's frame rate", () => {
    const linear = { motionIn: "Linear", motionOut: "Linear" } as const;
    // 8 frames take 0.133 s at 60 fps and 0.267 s at 30 fps.
    assert.equal(clipAnimationWeight(linear, 8, 60, 8 / 60, 2), 1);
    assertClose(clipAnimationWeight(linear, 8, 30, 8 / 60, 2), 0.5);
  });

  it("is fully in for a clip with no length or no timing", () => {
    assert.equal(weightAt(0, 0), 1);
    assert.equal(weightAt(0, 60, EASE, 0), 1);
  });
});

function parameter(key: string, value: number) {
  return { key, value: value.toFixed(3), numericValue: value };
}

describe("applyClipAnimationWeight", () => {
  it("runs each knob from its neutral value to its set value", () => {
    const parameters = applyClipAnimationWeight(
      {
        effectName: "Transform",
        parameters: [
          parameter("PositionX", 0.4),
          parameter("ScaleX", 2),
          parameter("OriginX", 0.5),
        ],
      },
      0.5,
    );
    assert.deepEqual(parameters, [
      parameter("PositionX", 0.2),
      parameter("ScaleX", 1.5),
      // Origin has no neutral value, so it stays put.
      parameter("OriginX", 0.5),
      // Knobs the effect doesn't store animate towards their default.
      parameter("PositionY", 0),
      parameter("ScaleY", 1),
      parameter("Rotation", 0),
    ]);
  });

  it("leaves the parameters as they are once fully in", () => {
    const effect = {
      effectName: "Colorize",
      parameters: [parameter("_HueOffset", 0.5)],
    };
    assert.equal(applyClipAnimationWeight(effect, 1), effect.parameters);
  });

  it("fades Color through its opacity, which defaults to 1", () => {
    assert.deepEqual(
      applyClipAnimationWeight(
        {
          effectName: "Color",
          parameters: [{ key: "Color", value: "rgba(255,0,0,1)" }],
        },
        0.25,
      ),
      [{ key: "Color", value: "rgba(255,0,0,1)" }, parameter("Opacity", 0.25)],
    );
  });

  it("fades Text through the alpha of its colours and gradient", () => {
    const parameters = applyClipAnimationWeight(
      {
        effectName: "Text",
        parameters: [
          { key: "Text", value: "Hi #1" },
          { key: "Color", value: "#ffffff" },
          {
            key: "Gradient",
            value:
              "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(255,0,0,0.5) 100%)",
          },
          parameter("FontSize", 96),
        ],
      },
      0.5,
    );
    assert.deepEqual(parameters, [
      { key: "Text", value: "Hi #1" },
      { key: "Color", value: "rgba(255,255,255,0.5)" },
      {
        key: "Gradient",
        value:
          "linear-gradient(90deg, rgba(0,0,0,0.5) 0%, rgba(255,0,0,0.25) 100%)",
      },
      parameter("FontSize", 96),
    ]);
  });

  it("gives Order the generic spacing tween", () => {
    assert.deepEqual(
      applyClipAnimationWeight(
        {
          effectName: "Order",
          parameters: [
            { key: "Arrangement", value: "Grid" },
            parameter("Spacing", 0.1),
          ],
        },
        0.5,
      ),
      [{ key: "Arrangement", value: "Grid" }, parameter("Spacing", 0.05)],
    );
  });

  it("leaves effects without neutral values alone", () => {
    assert.deepEqual(fadeCssColors("no colour here", 0), "no colour here");
    assert.deepEqual(
      applyClipAnimationWeight(
        {
          effectName: "Layout",
          parameters: [{ key: "Position", value: "Top" }],
        },
        0,
      ),
      [{ key: "Position", value: "Top" }],
    );
  });
});

function clipAnimation(
  effectName: string,
  clip: Partial<ClipAnimation> = {},
): EffectAnimation {
  const animation = createDefaultAnimation(effectName) as EffectAnimation;
  return { ...animation, clip: { ...animation.clip, ...clip } };
}

function colorize(
  id: string,
  trackId: string,
  hueOffset: number,
  animation = clipAnimation("Colorize"),
): SessionEffect {
  return {
    id,
    trackId,
    effectName: "Colorize",
    parameters: [parameter("_HueOffset", hueOffset)],
    enabled: true,
    animation,
  };
}

function frameToQ(frame: number) {
  return ((frame / FPS) * BPM) / 60;
}

function fillClip(
  id: string,
  laneId: string,
  frameStart: number,
  frameEnd: number,
): ArrangementClip {
  return {
    id,
    kind: "fill",
    sourceTrackId: laneId,
    laneId,
    label: id,
    mediaPath: "",
    startQ: frameToQ(frameStart),
    durationSeconds: (frameEnd - frameStart) / FPS,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: (frameEnd - frameStart) / FPS,
    tint: "#000",
    accent: "#fff",
  };
}

const LANE_PRIORITY = new Map([
  ["top", 0],
  ["bottom", 1],
]);

function activeAt(
  clips: ArrangementClip[],
  effects: SessionEffect[],
  frame: number,
  fps = FPS,
) {
  return computeActiveClips(
    clips,
    new Map(),
    frameToQ(frame),
    BPM,
    LANE_PRIORITY,
    effects,
    fps,
  );
}

function hueOffsetOf(
  clips: ArrangementClip[],
  effects: SessionEffect[],
  frame: number,
  clipId: string,
) {
  const entry = activeAt(clips, effects, frame).find(
    (candidate) => candidate.clip.id === clipId,
  );
  assert.ok(entry, `${clipId} is active at frame ${frame}`);
  const value = entry.effectChain[0]?.parameters.find(
    (candidate) => candidate.key === "_HueOffset",
  )?.numericValue;
  assert.ok(value !== undefined);
  return value;
}

describe("Clip mode rendering", () => {
  it("animates a layer Colorize in and out at Normal (8 frames)", () => {
    assert.equal(getClipTimingFrames("Colorize", "Normal"), 8);
    const clips = [fillClip("a", "top", 0, 60)];
    const effects = [colorize("fx", "top", 0.5)];
    assert.equal(hueOffsetOf(clips, effects, 0, "a"), 0);
    assertClose(
      hueOffsetOf(clips, effects, 4, "a"),
      0.5 * easeMotion("Ease Out", 0.5),
    );
    assert.equal(hueOffsetOf(clips, effects, 8, "a"), 0.5);
    assert.equal(hueOffsetOf(clips, effects, 30, "a"), 0.5);
    assertClose(
      hueOffsetOf(clips, effects, 59, "a"),
      0.5 * easeMotion("Ease In", 1 / 8),
    );
  });

  it("animates each clip on a layer on its own", () => {
    const clips = [fillClip("a", "top", 0, 60), fillClip("b", "top", 60, 120)];
    const effects = [colorize("fx", "top", 0.5)];
    assert.equal(hueOffsetOf(clips, effects, 60, "b"), 0);
    assertClose(
      hueOffsetOf(clips, effects, 64, "b"),
      hueOffsetOf(clips, effects, 4, "a"),
    );
    assert.equal(hueOffsetOf(clips, effects, 68, "b"), 0.5);
  });

  it("animates a Global effect per clip on each layer", () => {
    const clips = [
      fillClip("a", "top", 0, 60),
      fillClip("b", "bottom", 30, 90),
    ];
    const effects = [colorize("fx", GROUP_TRACK_ID, 0.5)];
    const active = activeAt(clips, effects, 34);
    // Each clip's own effects see the Global Colorize at its own weight.
    const [top, bottom] = active.map((entry) =>
      resolveAnimatedParameters(
        effects[0],
        {
          clipId: entry.clip.id,
          laneId: entry.clip.laneId,
          progress: entry.clipProgress,
          elapsedSeconds: entry.clipProgress * entry.clip.durationSeconds,
          durationSeconds: entry.clip.durationSeconds,
        },
        { playheadQ: frameToQ(34), bpm: BPM, fps: FPS },
      ),
    );
    assert.equal(top[0].numericValue, 0.5);
    assertClose(
      bottom[0].numericValue as number,
      0.5 * easeMotion("Ease Out", 0.5),
    );
  });

  it("animates whole-frame Global effects with the topmost clip", () => {
    const clips = [
      fillClip("a", "top", 30, 90),
      fillClip("b", "bottom", 0, 60),
    ];
    const effects = [colorize("fx", GROUP_TRACK_ID, 0.5)];
    const frameOffset = (frame: number) =>
      resolveEffectChain(
        resolveFrameEffects(
          effects,
          activeAt(clips, effects, frame),
          frameToQ(frame),
          BPM,
          FPS,
        ),
        GROUP_TRACK_ID,
      )[0].parameters[0].numericValue;
    // Before the top clip enters, the bottom one is the topmost.
    assert.equal(frameOffset(20), 0.5);
    // The top clip has just entered, so the Global chain animates in again.
    assert.equal(frameOffset(30), 0);
    assert.equal(frameOffset(38), 0.5);
    // With no active clip it is drawn as set.
    assert.equal(
      resolveFrameEffects(effects, [], frameToQ(200), BPM, FPS),
      effects,
    );
  });

  it("is immediate with None and unchanged while animation is off", () => {
    const clips = [fillClip("a", "top", 0, 60)];
    const none = clipAnimation("Colorize", {
      motionIn: "None",
      motionOut: "None",
    });
    assert.equal(
      hueOffsetOf(clips, [colorize("fx", "top", 0.5, none)], 0, "a"),
      0.5,
    );
    const off = { ...clipAnimation("Colorize"), enabled: false };
    assert.equal(
      hueOffsetOf(clips, [colorize("fx", "top", 0.5, off)], 0, "a"),
      0.5,
    );
    const reactive: EffectAnimation = {
      ...clipAnimation("Colorize"),
      mode: "reactive",
    };
    assert.equal(
      hueOffsetOf(clips, [colorize("fx", "top", 0.5, reactive)], 0, "a"),
      0.5,
    );
  });

  it("uses the chosen timing at the session's frame rate", () => {
    const clips = [fillClip("a", "top", 0, 120)];
    const fast = [
      colorize("fx", "top", 0.5, clipAnimation("Colorize", { timing: "Fast" })),
    ];
    // Fast is 4 frames.
    assert.equal(hueOffsetOf(clips, fast, 4, "a"), 0.5);
    // At 60 fps the same 8 frames of Normal take half as long.
    const [entry] = activeAt(clips, [colorize("fx", "top", 0.5)], 4, 60);
    assert.equal(entry.effectChain[0].parameters[0].numericValue, 0.5);
  });

  it("draws an export frame exactly as the preview frame", () => {
    const clips = [
      fillClip("a", "top", 0, 60),
      fillClip("b", "bottom", 10, 50),
    ];
    const effects = [
      colorize("layer", "top", 0.5),
      colorize("global", GROUP_TRACK_ID, -0.25),
    ];
    // Preview scrubs to frame 5; export renders every frame up to it.
    const preview = activeAt(clips, effects, 5);
    for (let frame = 0; frame < 5; frame += 1) {
      activeAt(clips, effects, frame);
    }
    const exported = activeAt(clips, effects, 5);
    assert.deepEqual(exported, preview);
    assert.deepEqual(
      resolveFrameEffects(effects, exported, frameToQ(5), BPM, FPS),
      resolveFrameEffects(effects, preview, frameToQ(5), BPM, FPS),
    );
  });
});
