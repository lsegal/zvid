import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import type { LvpSession } from "../../session.ts";
import {
  type AlsImportResult,
  convertAls,
  siblingAudioFilename,
} from "./convert.ts";
import type { AlsClip, AlsDocument, AlsTrack } from "./parse.ts";
import { parseAls } from "./parse.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../test/fixtures/als/${name}`, import.meta.url));

type LvpClip = NonNullable<LvpSession["clips"]>[number];

// The Layers app wrote float32 values, e.g. 0.014833333 for 0.0148333332327.
function assertClose(actual: unknown, expected: unknown, message: string) {
  assert.equal(typeof actual, "number", message);
  assert.ok(
    Math.abs((actual as number) - (expected as number)) < 1e-6,
    `${message}: ${actual} ≉ ${expected}`,
  );
}

const basename = (path: string) => path.split(/[\\/]/).at(-1);

describe("convertAls with dogfood3.als against dogfood3.lvp", () => {
  const golden = JSON.parse(fixture("dogfood3.lvp").toString("utf8"));
  let result: AlsImportResult;
  let session: LvpSession;
  before(async () => {
    result = convertAls(
      await parseAls(new Uint8Array(fixture("dogfood3.als"))),
      {
        sessionFile: golden.sessionFile,
        audioFilename: siblingAudioFilename(golden.sessionFile),
      },
    );
    session = result.session;
  });

  const clip = (id: string) => {
    const found = session.clips?.find((candidate) => candidate.id === id);
    assert.ok(found, `missing clip ${id}`);
    return found;
  };
  const goldenClip = (id: string): LvpClip =>
    golden.clips.find((candidate: LvpClip) => candidate.id === id);

  it("keeps every audio and MIDI track, with Layers recordings", () => {
    assert.deepEqual(session.tracks, [
      ...golden.tracks.map(
        (track: NonNullable<LvpSession["tracks"]>[number]) => ({
          id: track.id,
          name: track.name,
          // `numFrames`/`frameRate` come from media probing, not the .als.
          recordings: track.recordings?.map(({ filename, frameStart }) => ({
            filename,
            frameStart,
          })),
        }),
      ),
      // The Layers app dropped 4-Audio, which has no Layers Record device.
      { id: "17", name: "4-Audio", recordings: [] },
    ]);
  });

  it("maps the timeline, session file and audio", () => {
    const { bpm, fps, canvasWidth, canvasHeight, projectDuration } =
      golden.timeline;
    assert.deepEqual(session.timeline, {
      bpm,
      fps,
      canvasWidth,
      canvasHeight,
      projectDuration,
    });
    assert.equal(session.sessionFile, golden.sessionFile);
    assert.equal(session.audioFilename, golden.audioFilename);
  });

  it("produces the golden clips in order, minus the dropped sub-frame clip, plus 4-Audio's", () => {
    assert.deepEqual(
      session.clips?.map((candidate) => candidate.id),
      ["12-4", "8-6", "16-2", "17-6", "17-10"],
    );
  });

  for (const id of ["12-4", "8-6", "16-2"]) {
    it(`matches the golden fields of clip ${id}`, () => {
      const actual = clip(id);
      const expected = goldenClip(id);
      for (const field of [
        "trackId",
        "frameStart",
        "frameOffset",
        "frameHiddenLoopEnd",
      ] as const) {
        assert.equal(actual[field], expected[field], `${id} ${field}`);
      }
      assert.equal(actual.warpMarkers?.length, expected.warpMarkers?.length);
      actual.warpMarkers?.forEach((marker, index) => {
        const expectedMarker = expected.warpMarkers?.[index];
        assert.equal(marker.id, expectedMarker?.id);
        assert.equal(marker.clipId, expectedMarker?.clipId);
        assertClose(marker.secTime, expectedMarker?.secTime, `${id} secTime`);
        assertClose(
          marker.beatTime,
          expectedMarker?.beatTime,
          `${id} beatTime`,
        );
      });
      if (expected.audioFileDuration === "NaN") {
        assert.equal(actual.audioFileDuration, "NaN");
      } else {
        assertClose(
          actual.audioFileDuration,
          expected.audioFileDuration,
          `${id} audioFileDuration`,
        );
      }
      // The Layers app resolved some recordings to absolute paths; the
      // importer keeps the recording's filename and leaves resolution to
      // media relinking.
      assert.equal(actual.filePath, basename(expected.filePath));
    });
  }

  it("matches the golden frameCount, clipStart and captureOffset where they agree", () => {
    assert.equal(clip("12-4").frameCount, goldenClip("12-4").frameCount);
    assert.equal(clip("12-4").captureOffset, goldenClip("12-4").captureOffset);
    assert.equal(clip("8-6").frameCount, goldenClip("8-6").frameCount);
    assert.equal(clip("8-6").captureOffset, goldenClip("8-6").captureOffset);
    assert.equal(clip("16-2").frameCount, goldenClip("16-2").frameCount);
    assert.equal(clip("16-2").clipStart, goldenClip("16-2").clipStart);
  });

  // Where the .lvp (saved by the old app, likely after manual edits) and the
  // .als disagree, the importer derives values from the .als. See #130.
  describe("documented divergences from dogfood3.lvp", () => {
    it("8-6 clipStart comes from LoopStart 22 (313, not 316)", () => {
      assert.equal(goldenClip("8-6").clipStart, 316);
      assert.equal(clip("8-6").clipStart, 313);
    });

    it("16-2 captureOffset is the recording's frameStart (107, not 106)", () => {
      assert.equal(goldenClip("16-2").captureOffset, 106);
      assert.equal(clip("16-2").captureOffset, 107);
    });

    it("drops 16-3, a 0.034-beat clip shorter than one frame, and reports it", () => {
      assert.ok(goldenClip("16-3"));
      assert.equal(
        session.clips?.some((candidate) => candidate.id === "16-3"),
        false,
      );
      assert.deepEqual(
        result.summary.skipped.find((entry) => entry.clipId === "16-3"),
        {
          trackId: "16",
          trackName: "3-Audio",
          clipId: "16-3",
          clipName: "Audio 11",
          reason: "shorter-than-frame",
        },
      );
    });

    it("12-4 (MIDI) clipStart maps the arrangement onto the recording (0, not 42)", () => {
      assert.equal(goldenClip("12-4").clipStart, 42);
      assert.equal(clip("12-4").clipStart, 0);
    });

    it("playPosition comes from Transport/CurrentTime 22.25 (317, not 79)", () => {
      assert.equal(golden.playPosition, 79);
      assert.equal(session.playPosition, 317);
      assert.equal(session.playStartPosition, 317);
    });

    it("clip names come from the .als rather than the .lvp's empty names", () => {
      assert.equal(goldenClip("8-6").name, "");
      assert.equal(clip("8-6").name, "Audio 7");
    });
  });

  it("imports 4-Audio's clips as audio from their samples", () => {
    const sample =
      "C:/Users/Loren/Documents/Layers/dogfood3 Project/Samples/Recorded/4-Audio 0002 [2023-12-13 122224].wav";
    assert.deepEqual(
      session.clips
        ?.filter((candidate) => candidate.trackId === "17")
        .map(({ id, frameStart, frameCount, filePath, captureOffset }) => ({
          id,
          frameStart,
          frameCount,
          filePath,
          captureOffset,
        })),
      [
        {
          id: "17-6",
          frameStart: 0,
          frameCount: 159,
          filePath: sample,
          captureOffset: 0,
        },
        {
          id: "17-10",
          frameStart: 159,
          frameCount: 158,
          filePath: sample,
          captureOffset: 0,
        },
      ],
    );
    assert.equal(result.summary.hasLayersVideo, true);
  });

  it("generates one main track and one selection per Layers clip", () => {
    assert.deepEqual(session.mainTracks, [{ id: "1", name: "Layer 1" }]);
    assert.deepEqual(session.selections, [
      {
        id: 1,
        trackId: "12",
        mainTrackId: "1",
        frameStart: 0,
        frameEnd: 317,
        selected: false,
      },
      {
        id: 2,
        trackId: "8",
        mainTrackId: "1",
        frameStart: 0,
        frameEnd: 317,
        selected: false,
      },
      {
        id: 3,
        trackId: "16",
        mainTrackId: "1",
        frameStart: 0,
        frameEnd: 316,
        selected: false,
      },
    ]);
  });
});

describe("convertAls with synthetic sets", () => {
  // 120 BPM at 30 fps: one beat is 15 frames.
  const audioClip = (overrides: Partial<AlsClip> = {}): AlsClip => ({
    id: 1,
    kind: "audio",
    name: "Clip",
    time: 0,
    currentStart: 0,
    currentEnd: 4,
    disabled: false,
    loop: {
      loopStart: 0,
      loopEnd: 4,
      startRelative: 0,
      loopOn: false,
      hiddenLoopStart: 0,
      hiddenLoopEnd: 8,
    },
    isWarped: true,
    warpMode: 0,
    warpMarkers: [
      { secTime: 0, beatTime: 0 },
      { secTime: 0.5, beatTime: 1 },
    ],
    sample: {
      path: "a.wav",
      relativePath: "a.wav",
      defaultDuration: 480000,
      defaultSampleRate: 48000,
    },
    ...overrides,
  });
  const videoTrack = (overrides: Partial<AlsTrack> = {}): AlsTrack => ({
    id: 5,
    kind: "audio",
    name: "Video",
    color: 0,
    groupId: null,
    clips: [audioClip()],
    layers: {
      version: "1",
      recordings: [
        {
          filename: "take-0.mp4",
          dimensions: [640, 480],
          fps: [30, 1],
          frameStart: 0,
        },
        {
          filename: "take-1.mp4",
          dimensions: [640, 480],
          fps: [30, 1],
          frameStart: 12,
        },
      ],
    },
    isVideoTrack: true,
    ...overrides,
  });
  const doc = (
    tracks: AlsTrack[],
    overrides: Partial<AlsDocument> = {},
  ): AlsDocument => ({
    creator: "Ableton Live 12",
    majorVersion: "5",
    minorVersion: "12.0",
    tempo: 120,
    tempoAutomation: [{ time: -63072000, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 },
    transport: { currentTime: 2, loopOn: false, loopStart: 0, loopLength: 4 },
    tracks,
    ...overrides,
  });

  it("unrolls a looped clip into suffixed segments", () => {
    const looped = audioClip({
      currentEnd: 10,
      loop: {
        loopStart: 0,
        loopEnd: 4,
        startRelative: 1,
        loopOn: true,
        hiddenLoopStart: 0,
        hiddenLoopEnd: 8,
      },
    });
    const { session } = convertAls(doc([videoTrack({ clips: [looped] })]));
    assert.deepEqual(
      session.clips?.map(({ id, frameStart, frameCount, clipStart }) => ({
        id,
        frameStart,
        frameCount,
        clipStart,
      })),
      [
        { id: "5-1", frameStart: 0, frameCount: 45, clipStart: 15 },
        { id: "5-1~1", frameStart: 45, frameCount: 60, clipStart: 0 },
        { id: "5-1~2", frameStart: 105, frameCount: 45, clipStart: 0 },
      ],
    );
    assert.deepEqual(
      session.clips?.[1].warpMarkers?.map((marker) => marker.clipId),
      ["5-1~1", "5-1~1"],
    );
    assert.deepEqual(
      session.selections?.map(({ frameStart, frameEnd }) => [
        frameStart,
        frameEnd,
      ]),
      [
        [0, 45],
        [45, 105],
        [105, 150],
      ],
    );
  });

  it("plays a non-Layers audio clip from its sample", () => {
    const { session, summary } = convertAls(
      doc([
        videoTrack(),
        videoTrack({
          id: 6,
          name: "Drums",
          clips: [audioClip({ id: 2, currentStart: 4, currentEnd: 8 })],
          layers: null,
          isVideoTrack: false,
        }),
      ]),
    );
    const drums = session.clips?.find((clip) => clip.trackId === "6");
    assert.deepEqual(
      drums && {
        id: drums.id,
        frameStart: drums.frameStart,
        frameCount: drums.frameCount,
        filePath: drums.filePath,
        captureOffset: drums.captureOffset,
        audioFileDuration: drums.audioFileDuration,
      },
      {
        id: "6-2",
        frameStart: 60,
        frameCount: 60,
        filePath: "a.wav",
        captureOffset: 0,
        audioFileDuration: 10,
      },
    );
    assert.deepEqual(summary, { skipped: [], hasLayersVideo: true });
    // The arrangement keeps showing the Layers video.
    assert.deepEqual(
      session.selections?.map((selection) => selection.trackId),
      ["5"],
    );
  });

  it("imports a set without Layers video as placeholder clips", () => {
    const midi = audioClip({
      kind: "midi",
      currentStart: 8,
      currentEnd: 16,
      loop: {
        loopStart: 0,
        loopEnd: 4,
        startRelative: 0,
        loopOn: true,
        hiddenLoopStart: 0,
        hiddenLoopEnd: 4,
      },
      warpMarkers: [],
      sample: null,
    });
    const { session, summary } = convertAls(
      doc([
        videoTrack({
          kind: "midi",
          name: "Keys",
          clips: [midi],
          layers: null,
          isVideoTrack: false,
        }),
      ]),
    );
    assert.deepEqual(session.tracks, [
      { id: "5", name: "Keys", recordings: [] },
    ]);
    assert.deepEqual(
      session.clips?.map(
        ({ id, frameStart, frameCount, clipStart, filePath }) => ({
          id,
          frameStart,
          frameCount,
          clipStart,
          filePath,
        }),
      ),
      [
        {
          id: "5-1",
          frameStart: 120,
          frameCount: 60,
          clipStart: 120,
          filePath: "",
        },
        {
          id: "5-1~1",
          frameStart: 180,
          frameCount: 60,
          clipStart: 180,
          filePath: "",
        },
      ],
    );
    assert.deepEqual(summary, { skipped: [], hasLayersVideo: false });
    assert.deepEqual(
      session.selections?.map(({ frameStart, frameEnd }) => [
        frameStart,
        frameEnd,
      ]),
      [
        [120, 180],
        [180, 240],
      ],
    );
    assert.equal(session.timeline?.fps, 30);
    assert.equal(session.timeline?.canvasWidth, undefined);
  });

  it("uses the track's last recording for every clip", () => {
    const { session } = convertAls(doc([videoTrack()]));
    assert.equal(session.clips?.[0].filePath, "take-1.mp4");
    assert.equal(session.clips?.[0].captureOffset, 12);
  });

  it("skips disabled clips and Layers tracks without recordings", () => {
    const { session, summary } = convertAls(
      doc([
        videoTrack({ clips: [audioClip({ disabled: true })] }),
        videoTrack({
          id: 6,
          name: "Empty",
          layers: { version: "1", recordings: [] },
        }),
      ]),
    );
    assert.deepEqual(session.clips, []);
    assert.deepEqual(
      summary.skipped.map(({ clipId, reason }) => [clipId, reason]),
      [
        ["5-1", "disabled"],
        ["6-1", "no-recording"],
      ],
    );
    assert.deepEqual(
      session.tracks?.map((track) => track.id),
      ["5", "6"],
    );
  });

  it("clamps a MIDI clip's clipStart to the recording start", () => {
    const midi = audioClip({
      kind: "midi",
      currentStart: 1,
      currentEnd: 3,
      warpMarkers: [],
      sample: null,
    });
    const { session } = convertAls(doc([videoTrack({ clips: [midi] })]));
    assert.equal(session.clips?.[0].frameStart, 15);
    // 15 frames into the arrangement, minus the take's frameStart of 12.
    assert.equal(session.clips?.[0].clipStart, 3);
    assert.equal(session.clips?.[0].audioFileDuration, "NaN");

    const early = convertAls(
      doc([videoTrack({ clips: [{ ...midi, currentStart: 0.5 }] })]),
    );
    assert.equal(early.session.clips?.[0].frameStart, 8);
    assert.equal(early.session.clips?.[0].clipStart, 0);
  });

  it("maps unwarped audio content in sample seconds", () => {
    const unwarped = audioClip({
      isWarped: false,
      loop: {
        loopStart: 1.5,
        loopEnd: 10,
        startRelative: 0,
        loopOn: false,
        hiddenLoopStart: 0,
        hiddenLoopEnd: 10,
      },
    });
    const { session } = convertAls(doc([videoTrack({ clips: [unwarped] })]));
    assert.equal(session.clips?.[0].clipStart, 45);
    assert.equal(session.clips?.[0].frameHiddenLoopEnd, 300);
  });

  it("ends the project at the last clip when the transport loop is off", () => {
    const { session } = convertAls(doc([videoTrack()]));
    assert.equal(session.timeline?.projectDuration, 60);
    assert.equal(session.playPosition, 30);
  });

  it("uses the most common recording format for the canvas and fps", () => {
    const { session } = convertAls(
      doc([
        videoTrack({
          layers: {
            version: "1",
            recordings: [
              {
                filename: "a.mp4",
                dimensions: [1920, 1080],
                fps: [24, 1],
                frameStart: 0,
              },
              {
                filename: "b.mp4",
                dimensions: [1080, 1920],
                fps: [30000, 1001],
                frameStart: 0,
              },
              {
                filename: "c.mp4",
                dimensions: [1080, 1920],
                fps: [30000, 1001],
                frameStart: 0,
              },
            ],
          },
        }),
      ]),
    );
    assert.equal(session.timeline?.canvasWidth, 1080);
    assert.equal(session.timeline?.canvasHeight, 1920);
    assert.equal(session.timeline?.fps, 30000 / 1001);
  });
});

describe("siblingAudioFilename", () => {
  it("swaps the .als extension for .wav", () => {
    assert.equal(
      siblingAudioFilename("C:\\Sets\\dogfood3 Project\\dogfood3.als"),
      "C:\\Sets\\dogfood3 Project\\dogfood3.wav",
    );
    assert.equal(siblingAudioFilename("/sets/Song.ALS"), "/sets/Song.wav");
  });
});
