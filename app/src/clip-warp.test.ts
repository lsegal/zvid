import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClipWarp, warpSourceTime } from "./clip-warp.ts";
import {
  type ArrangementClip,
  computeActiveClips,
  type MediaItem,
} from "./composition-active-clips.ts";

const BPM = 120;

function assertClose(actual: number, expected: number, message?: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message ?? "value"}: expected ${expected}, got ${actual}`,
  );
}

// Song time → source time for a clip whose content starts at sample second
// `sampleStart` and whose linear source position starts at `anchor`.
function sourceTimeAt(
  markers: { beatTime: number; secTime: number }[],
  sampleStart: number,
  anchor: number,
  elapsedSeconds: number,
  bpm = BPM,
) {
  const warp = createClipWarp(markers, sampleStart, anchor, bpm);
  assert.ok(warp, "expected a warp");
  return warpSourceTime(warp, anchor + elapsedSeconds, bpm);
}

describe("createClipWarp", () => {
  it("leaves clips without two usable markers unwarped", () => {
    assert.equal(createClipWarp(undefined, 0, 0, BPM), undefined);
    assert.equal(createClipWarp([], 0, 0, BPM), undefined);
    assert.equal(
      createClipWarp([{ beatTime: 0, secTime: 0 }], 0, 0, BPM),
      undefined,
    );
    assert.equal(
      createClipWarp(
        [
          { beatTime: 1, secTime: 0 },
          { beatTime: 1, secTime: 4 },
        ],
        0,
        0,
        BPM,
      ),
      undefined,
    );
  });

  it("leaves a linear warp at the song tempo on the 1× path", () => {
    // Two markers a fraction of a beat apart, as Live often stores them.
    assert.equal(
      createClipWarp(
        [
          { beatTime: 4, secTime: 2 },
          { beatTime: 4.03125, secTime: 2.015625 },
        ],
        3,
        3,
        BPM,
      ),
      undefined,
    );
    // Many markers, all on the song tempo line.
    assert.equal(
      createClipWarp(
        Array.from({ length: 89 }, (_, index) => ({
          beatTime: index,
          secTime: 0.25 + index / 2,
        })),
        1,
        1,
        BPM,
      ),
      undefined,
    );
  });

  it("finds the content start beat from the sample start", () => {
    const warp = createClipWarp(
      [
        { beatTime: 0, secTime: 0 },
        { beatTime: 4, secTime: 1 },
        { beatTime: 8, secTime: 5 },
      ],
      3,
      10,
      BPM,
    );
    assert.equal(warp?.contentStartBeat, 6);
    assert.equal(warp?.anchorSeconds, 10);
  });

  it("ignores marker order and non-finite markers", () => {
    const warp = createClipWarp(
      [
        { beatTime: 8, secTime: 8 },
        { beatTime: Number.NaN, secTime: 1 },
        { beatTime: 0, secTime: 0 },
      ],
      0,
      0,
      BPM,
    );
    assert.deepEqual(warp?.markers, [
      { beatTime: 0, secTime: 0 },
      { beatTime: 8, secTime: 8 },
    ]);
  });
});

describe("warpSourceTime", () => {
  it("plays a linear warp off the song tempo at a constant rate", () => {
    // 8 beats (4 s at 120 BPM) span 8 s of source: 2× speed.
    const markers = [
      { beatTime: 0, secTime: 0 },
      { beatTime: 8, secTime: 8 },
    ];
    for (const elapsed of [0, 1, 2.5, 4, 6]) {
      const { seconds, rate } = sourceTimeAt(markers, 0, 0, elapsed);
      assertClose(seconds, elapsed * 2, `${elapsed} s`);
      assertClose(rate, 2, `${elapsed} s rate`);
    }
  });

  it("changes speed at each marker of a piecewise warp", () => {
    // Beats 0–4 cover 2 s of source (1×), beats 4–8 cover 4 s (2×).
    const markers = [
      { beatTime: 0, secTime: 0 },
      { beatTime: 4, secTime: 2 },
      { beatTime: 8, secTime: 6 },
    ];
    const expected = [
      [0, 0, 1],
      [1, 1, 1],
      [2, 2, 2],
      [3, 4, 2],
      [4, 6, 2],
    ];
    for (const [elapsed, seconds, rate] of expected) {
      const actual = sourceTimeAt(markers, 0, 0, elapsed);
      assertClose(actual.seconds, seconds, `${elapsed} s`);
      assertClose(actual.rate, rate, `${elapsed} s rate`);
    }
  });

  it("extrapolates past the first and last markers", () => {
    const markers = [
      { beatTime: 2, secTime: 1 },
      { beatTime: 4, secTime: 1.5 },
      { beatTime: 6, secTime: 3.5 },
    ];
    // Content starts at sample 0.5 s, beat 0, before the first marker.
    const start = sourceTimeAt(markers, 0.5, 0.5, 0);
    assertClose(start.seconds, 0.5);
    assertClose(start.rate, 0.5);
    // Beat 7 is past the last marker, on its slope: 3.5 + 1 beat × 1 s.
    const end = sourceTimeAt(markers, 0.5, 0.5, 3.5);
    assertClose(end.seconds, 4.5);
    assertClose(end.rate, 2);
  });

  it("starts at the content start when the first marker is offset", () => {
    // The first marker sits at beat 3.5, sample 2.917 s; content starts
    // there, 7 s into the file once the capture offset is added.
    const markers = [
      { beatTime: 3.5, secTime: 2.917 },
      { beatTime: 7.5, secTime: 5.417 },
    ];
    const start = sourceTimeAt(markers, 2.917, 7, 0);
    assertClose(start.seconds, 7);
    // 4 beats at 120 BPM (2 s of song) cover 2.5 s of source.
    const end = sourceTimeAt(markers, 2.917, 7, 2);
    assertClose(end.seconds, 9.5);
    assertClose(end.rate, 1.25);
  });

  it("follows the anchor when a clip is moved or trimmed", () => {
    const warp = createClipWarp(
      [
        { beatTime: 0, secTime: 0 },
        { beatTime: 4, secTime: 4 },
      ],
      0,
      0,
      BPM,
    );
    assert.ok(warp);
    // A window starting 1 s later in linear source time plays 2 s later in
    // the warped source.
    assertClose(warpSourceTime(warp, 1, BPM).seconds, 2);
  });
});

describe("warped clip playback", () => {
  // An imported video clip on an audio track, warped to a 72 BPM song: its
  // 15 beats (12.5 s of song) cover 10.68 s of video. The session writes the
  // imported-video sentinel `captureOffset: -1`, and `clipStart` 339 is the
  // warp position of the clip start at 30 fps.
  const FPS = 30;
  const SONG_BPM = 72;
  const session = {
    frameStart: 300,
    frameCount: 375,
    clipStart: 339,
    frameOffset: 0,
    captureOffset: -1,
    warpMarkers: [
      { beatTime: 0, secTime: 0 },
      { beatTime: 20, secTime: 11.3 },
      { beatTime: 35, secTime: 21.98 },
    ],
  };
  const media: MediaItem = {
    id: "video",
    name: "video.mov",
    kind: "video",
    durationSeconds: 30,
    hasAudio: true,
    hasVideo: true,
    previewUrl: "/video.mov",
  };

  // Maps the session clip the way sessionToProject does.
  const startSeconds = session.frameStart / FPS;
  // The sentinel capture offset adds nothing to the source position.
  const trimStartSeconds =
    Math.max(0, session.clipStart + session.frameOffset) / FPS;
  const clip: ArrangementClip = {
    id: "selection-1",
    sourceTrackId: "1",
    laneId: "1",
    label: "Video",
    mediaPath: media.name,
    mediaId: media.id,
    startQ: (startSeconds * SONG_BPM) / 60,
    durationSeconds: session.frameCount / FPS,
    trimStartSeconds,
    sourceOffsetSeconds: trimStartSeconds - startSeconds,
    sourceWindowStartSeconds: trimStartSeconds,
    sourceWindowEndSeconds: trimStartSeconds + session.frameCount / FPS,
    warp: createClipWarp(
      session.warpMarkers,
      (session.clipStart + session.frameOffset) / FPS,
      trimStartSeconds,
      SONG_BPM,
    ),
    tint: "#000",
    accent: "#fff",
  };

  const activeAt = (songSeconds: number) => {
    const [active] = computeActiveClips(
      [clip],
      new Map([[media.id, media]]),
      (songSeconds * SONG_BPM) / 60,
      SONG_BPM,
      new Map([["1", 0]]),
      [],
    );
    return active;
  };

  it("plays the imported video along its warp markers", () => {
    const start = activeAt(startSeconds);
    assertClose(start.mediaTime, 11.3, "clip start");
    assert.ok(start.isInBounds);

    // Halfway through, 7.5 beats in: 11.3 + 7.5 × 10.68 / 15 s.
    const middle = activeAt(startSeconds + 6.25);
    assertClose(middle.mediaTime, 16.64, "clip middle");
    assertClose(middle.playbackRate, 10.68 / 12.5, "clip middle rate");

    // 10 ms before the end, the video is 10 ms × rate short of 21.98 s,
    // where playing at 1× would reach 11.3 + 12.49 s.
    const end = activeAt(startSeconds + 12.49);
    assertClose(end.mediaTime, 21.98 - 0.01 * (10.68 / 12.5), "clip end");
    assert.ok(end.isInBounds);
  });

  it("keeps an unwarped clip at 1×", () => {
    const [active] = computeActiveClips(
      [{ ...clip, warp: undefined }],
      new Map([[media.id, media]]),
      ((startSeconds + 6.25) * SONG_BPM) / 60,
      SONG_BPM,
      new Map([["1", 0]]),
      [],
    );
    assertClose(active.mediaTime, 11.3 + 6.25);
    assert.equal(active.playbackRate, 1);
  });
});
