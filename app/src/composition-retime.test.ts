import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAudioClips } from "./audio-mix/resolve.ts";
import {
  type ArrangementClip,
  computeActiveClips,
  type MediaItem,
  type SessionEffect,
} from "./composition-active-clips.ts";
import {
  computeActiveClipTimings,
  mediaSourceTimings,
} from "./composition-clip-timing.ts";
import { indexEffects } from "./composition-effect-index.ts";
import { findClipRetimes } from "./composition-retime.ts";
import { RETIME_EFFECT_NAME } from "./fx/effects/retime/retime.ts";
import { createEffect } from "./fx/stack/ops.ts";
import { clipEffectTrackId } from "./fx-stack.ts";
import { mediaWindowAt } from "./media-window.ts";

// 60 BPM, so a quarter note is a second.
const BPM = 60;
const FPS = 20;

const VIDEO: MediaItem = {
  id: "video",
  name: "video.mp4",
  kind: "video",
  durationSeconds: 10,
  hasAudio: true,
  hasVideo: true,
  previewUrl: "blob:video",
};

// A clip at 2 s showing the media from 3 s in.
const CLIP: ArrangementClip = {
  id: "a",
  sourceTrackId: "track",
  laneId: "lane",
  label: "a",
  mediaPath: "video.mp4",
  mediaId: "video",
  startQ: 2,
  durationSeconds: 6,
  trimStartSeconds: 3,
  sourceOffsetSeconds: 1,
  sourceWindowStartSeconds: 3,
  sourceWindowEndSeconds: 9,
  tint: "#000",
  accent: "#fff",
};

function retime(speed: number, interpolation = "None"): SessionEffect {
  const effect = createEffect(clipEffectTrackId(CLIP.id), RETIME_EFFECT_NAME);
  return {
    ...effect,
    parameters: [
      { key: "Speed", value: String(speed), numericValue: speed },
      { key: "Interpolation", value: interpolation },
    ],
  };
}

function timingAt(seconds: number, effects: SessionEffect[], clip = CLIP) {
  const [timing] = computeActiveClipTimings(
    [clip],
    new Map([[VIDEO.id, VIDEO]]),
    seconds,
    BPM,
    new Map([[clip.laneId, 0]]),
    [],
    findClipRetimes([clip], indexEffects(effects), FPS),
  );
  return timing;
}

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);

describe("Retime timing", () => {
  it("leaves a clip without a Retime as it was", () => {
    const timing = timingAt(4, []);
    near(timing.mediaTime, 5);
    assert.equal(timing.playbackRate, 1);
    assert.equal(timing.retimed, undefined);
  });

  it("plays twice as fast from the clip's first frame at 2×", () => {
    near(timingAt(2, [retime(2)]).mediaTime, 3);
    const timing = timingAt(4, [retime(2)]);
    near(timing.mediaTime, 7);
    assert.equal(timing.playbackRate, 2);
    assert.equal(timing.retimed, true);
    assert.equal(timing.isInBounds, true);
  });

  it("freezes on the clip's first frame at 0×", () => {
    const timing = timingAt(6, [retime(0)]);
    near(timing.mediaTime, 3);
    assert.equal(timing.playbackRate, 0);
  });

  it("plays backwards at -1×, looping from the media's end past its start", () => {
    near(timingAt(4, [retime(-1)]).mediaTime, 1);
    // 4 s back from 3 s is -1 s: the media's last second.
    const timing = timingAt(6, [retime(-1)]);
    near(timing.mediaTime, 9);
    assert.equal(timing.playbackRate, -1);
    assert.equal(timing.isInBounds, true);
  });

  it("loops past the media's end at 5×", () => {
    // 3 s + 2 s × 5 = 13 s, 3 s into the 10 s media's second loop.
    near(timingAt(4, [retime(5)]).mediaTime, 3);
  });

  it("keeps every 0.1 step from -5× to 5× inside the media", () => {
    for (let tenths = -50; tenths <= 50; tenths++) {
      for (const seconds of [2, 3.3, 5.05, 7.9]) {
        const { mediaTime, isInBounds } = timingAt(seconds, [
          retime(tenths / 10),
        ]);
        assert.ok(isInBounds);
        assert.ok(mediaTime >= 0 && mediaTime < VIDEO.durationSeconds);
        near(mediaTime, (((3 + (seconds - 2) * (tenths / 10)) % 10) + 10) % 10);
      }
    }
  });

  it("retimes a warped clip around where its warp draws its start", () => {
    // Warp markers play the clip's source at 2×, from 3 s at its start.
    const warped: ArrangementClip = {
      ...CLIP,
      warp: {
        markers: [
          { beatTime: 0, secTime: 0 },
          { beatTime: 4, secTime: 8 },
        ],
        contentStartBeat: 0,
        anchorSeconds: 3,
      },
    };
    const plain = timingAt(3, [], warped);
    const doubled = timingAt(3, [retime(-1)], warped);
    // Unretimed it is 2 s past its start; reversed, 2 s before it.
    near(plain.mediaTime, 5);
    near(doubled.mediaTime, 1);
    assert.equal(doubled.playbackRate, -plain.playbackRate);
  });

  it("blends a video between session frames, standing still", () => {
    // 2.025 s in at 1× is 5.025 s: halfway through the frame at 5 s.
    const timing = timingAt(4.025, [retime(1, "Blend")]);
    near(timing.mediaTime, 5.025);
    assert.equal(timing.playbackRate, 0);
    assert.ok(timing.blend);
    assert.equal(timing.blend.sourceKey, "video~blend");
    near(timing.blend.mediaTime, 5.075);
    near(timing.blend.weight, 0.5);
  });

  it("counts a video's own frames when its frame rate is known", () => {
    const [timing] = computeActiveClipTimings(
      [CLIP],
      new Map([[VIDEO.id, { ...VIDEO, fps: 10 }]]),
      4.025,
      BPM,
      new Map([[CLIP.laneId, 0]]),
      [],
      findClipRetimes([CLIP], indexEffects([retime(1, "Blend")]), FPS),
    );
    // 5.025 s is a quarter of the way through the 10 fps frame at 5 s.
    near(timing.mediaTime, 5.05);
    near(timing.blend?.mediaTime ?? 0, 5.15);
    near(timing.blend?.weight ?? 0, 0.25);
  });

  it("gives a blended clip's next frame an element of its own, at that frame", () => {
    const timing = timingAt(4.025, [retime(1, "Blend")]);
    const sources = mediaSourceTimings([timing]);
    assert.deepEqual(
      sources.map((entry) => [entry.sourceKey, entry.mediaTime]),
      [
        ["video", timing.mediaTime],
        ["video~blend", timing.blend?.mediaTime],
      ],
    );
    assert.equal(sources[1].playbackRate, 0);
    assert.equal(sources[1].blend, undefined);
  });

  it("draws the retimed time and next frame through computeActiveClips", () => {
    const [entry] = computeActiveClips(
      [CLIP],
      new Map([[VIDEO.id, VIDEO]]),
      4.025,
      BPM,
      new Map([[CLIP.laneId, 0]]),
      [retime(-2, "Blend")],
      FPS,
    );
    // 3 s - 2.025 s × 2 = -1.05 s, 8.95 s into the media: the frame at
    // 8.95 s, at its start.
    near(entry.mediaTime, 8.975);
    assert.equal(entry.blend?.weight, 0);
    assert.equal(entry.retimed, true);
  });

  it("ignores a disabled Retime", () => {
    const timing = timingAt(4, [{ ...retime(2), enabled: false }]);
    near(timing.mediaTime, 5);
  });

  it("keeps a retimed clip's video out of the mixer's elements", () => {
    const retimes = findClipRetimes([CLIP], indexEffects([retime(-1)]), FPS);
    const window = mediaWindowAt(
      [CLIP],
      new Map([[VIDEO.id, VIDEO]]),
      3,
      BPM,
      (clip) => !retimes.byClip.has(clip.id),
    );
    assert.equal(window.get(VIDEO.id), "auto");
  });
});

describe("Retime audio", () => {
  it("leaves the clip's sound playing at its own timing", () => {
    const clip = {
      id: "a",
      sourceSpanId: "span-a",
      sourceTrackId: "track-a",
      laneId: "lane",
      mediaPath: "video.mp4",
      mediaId: "video",
      startQ: 2,
      durationSeconds: 6,
      trimStartSeconds: 3,
      sourceOffsetSeconds: 1,
      sourceWindowStartSeconds: 3,
      sourceWindowEndSeconds: 9,
    };
    const inputs = (effects: SessionEffect[]) => ({
      clips: [clip],
      lanes: [{ id: "lane" }],
      sourceTracks: [{ id: "track-a" }],
      sourceSpans: [
        {
          id: "span-a",
          sourceTrackId: "track-a",
          mediaId: "video",
          startQ: 2,
          durationSeconds: 6,
          trimStartSeconds: 3,
        },
      ],
      mediaById: new Map([["video", { hasAudio: true }]]),
      effects,
      bpm: BPM,
    });
    const gain = createEffect(clipEffectTrackId("a"), "Gain", "gain");
    assert.deepEqual(
      resolveAudioClips(inputs([gain, retime(-2, "Blend")])),
      resolveAudioClips(inputs([gain])),
    );
  });
});
