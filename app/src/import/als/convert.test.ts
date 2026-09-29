import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import type { LvpSession } from "../../session.ts";
import {
  type AlsImportResult,
  convertAls,
  matchZvidTake,
  siblingAudioFilename,
} from "./convert.ts";
import type {
  AlsClip,
  AlsDocument,
  AlsTrack,
  ZvidCaptureState,
  ZvidCaptureTake,
} from "./parse.ts";
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

    // Until the video is probed; probing end-aligns it to 106 (see
    // `probeAlsRecordings`).
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

    it("12-4 (MIDI) clipStart is its content start, LoopStart 110.5 (1574, not 42)", () => {
      assert.equal(goldenClip("12-4").clipStart, 42);
      assert.equal(clip("12-4").clipStart, 1574);
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

  it("gives each Layers track its own layer, named after the track", () => {
    assert.deepEqual(session.mainTracks, [
      { id: "1", name: "1-Akustichord Kit" },
      { id: "2", name: "2-Audio" },
      { id: "3", name: "3-Audio" },
    ]);
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
        mainTrackId: "2",
        frameStart: 0,
        frameEnd: 317,
        selected: false,
      },
      {
        id: 3,
        trackId: "16",
        mainTrackId: "3",
        frameStart: 0,
        frameEnd: 316,
        selected: false,
      },
    ]);
    assert.deepEqual(result.summary.trimmed, []);
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
    assert.deepEqual(summary, {
      skipped: [],
      trimmed: [],
      hasLayersVideo: true,
      layersRecordTracks: ["5"],
    });
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
          clipStart: 0,
          filePath: "",
        },
        {
          id: "5-1~1",
          frameStart: 180,
          frameCount: 60,
          clipStart: 0,
          filePath: "",
        },
      ],
    );
    assert.deepEqual(summary, {
      skipped: [],
      trimmed: [],
      hasLayersVideo: false,
    });
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

  it("gives every track its own layer, even when clips never overlap", () => {
    // Drums and Bass play together; Keys only plays after both end.
    const { session, summary } = convertAls(
      doc([
        videoTrack({ id: 5, name: "Drums" }),
        videoTrack({ id: 6, name: "Bass" }),
        videoTrack({
          id: 7,
          name: "Keys",
          clips: [
            audioClip({ currentStart: 4, currentEnd: 8 }),
            audioClip({ id: 2, currentStart: 8, currentEnd: 12 }),
          ],
        }),
      ]),
    );
    assert.deepEqual(session.mainTracks, [
      { id: "1", name: "Drums" },
      { id: "2", name: "Bass" },
      { id: "3", name: "Keys" },
    ]);
    assert.deepEqual(
      session.selections?.map(
        ({ trackId, mainTrackId, frameStart, frameEnd }) => [
          trackId,
          mainTrackId,
          frameStart,
          frameEnd,
        ],
      ),
      [
        ["5", "1", 0, 60],
        ["6", "2", 0, 60],
        ["7", "3", 60, 120],
        ["7", "3", 120, 180],
      ],
    );
    assert.deepEqual(summary.skipped, []);
    assert.deepEqual(summary.trimmed, []);
  });

  it("names a layer whose track has no name Layer N", () => {
    const { session } = convertAls(
      doc([
        videoTrack({ id: 5, name: "Drums" }),
        videoTrack({ id: 6, name: " " }),
      ]),
    );
    assert.deepEqual(session.mainTracks, [
      { id: "1", name: "Drums" },
      { id: "2", name: "Layer 2" },
    ]);
  });

  it("names nine layers after their nine tracks", () => {
    const tracks = Array.from({ length: 9 }, (_, index) =>
      videoTrack({ id: 10 + index, name: `Cam ${index + 1}` }),
    );
    const { session } = convertAls(doc(tracks));
    assert.deepEqual(
      session.mainTracks?.map((track) => track.name),
      tracks.map((track) => track.name),
    );
  });

  it("puts tracks past nine on the last layer, the later clip winning", () => {
    // Nine tracks fill the layers from 0 to 4 beats. A tenth covers the
    // ninth entirely on the last layer, and an eleventh overlaps its tail.
    const tracks = Array.from({ length: 9 }, (_, index) =>
      videoTrack({ id: 10 + index, name: `Cam ${index + 1}` }),
    );
    const { session, summary } = convertAls(
      doc([
        ...tracks,
        videoTrack({ id: 30, name: "Cover" }),
        videoTrack({
          id: 31,
          name: "Tail",
          clips: [audioClip({ id: 2, currentStart: 3, currentEnd: 6 })],
        }),
      ]),
    );
    assert.deepEqual(
      session.mainTracks?.map((track) => track.name),
      // The shared last layer is named after none of its tracks.
      [...tracks.slice(0, 8).map((track) => track.name), "Layer 9"],
    );
    assert.deepEqual(
      session.selections?.map(
        ({ trackId, mainTrackId, frameStart, frameEnd }) => [
          trackId,
          mainTrackId,
          frameStart,
          frameEnd,
        ],
      ),
      [
        ...tracks
          .slice(0, 8)
          .map((_, index) => [String(10 + index), String(1 + index), 0, 60]),
        ["30", "9", 0, 45],
        ["31", "9", 45, 90],
      ],
    );
    assert.deepEqual(
      summary.skipped.map(({ clipId, trackName, reason }) => [
        clipId,
        trackName,
        reason,
      ]),
      [["18-1", "Cam 9", "overlapped"]],
    );
    assert.deepEqual(summary.trimmed, [
      {
        trackId: "30",
        trackName: "Cover",
        clipId: "30-1",
        clipName: "Clip",
      },
    ]);
  });

  it("starts a MIDI clip at its content start, offset by the recording", () => {
    const midi = audioClip({
      kind: "midi",
      currentStart: 1,
      currentEnd: 3,
      warpMarkers: [],
      sample: null,
    });
    const { session } = convertAls(doc([videoTrack({ clips: [midi] })]));
    assert.equal(session.clips?.[0].frameStart, 15);
    // Content from beat 0, wherever the clip sits in the arrangement.
    assert.equal(session.clips?.[0].clipStart, 0);
    assert.equal(session.clips?.[0].captureOffset, 12);
    assert.equal(session.clips?.[0].audioFileDuration, "NaN");

    const trimmed = convertAls(
      doc([
        videoTrack({
          clips: [{ ...midi, loop: { ...midi.loop, loopStart: 1 } }],
        }),
      ]),
    );
    assert.equal(trimmed.session.clips?.[0].clipStart, 15);
    assert.equal(trimmed.session.clips?.[0].captureOffset, 12);
  });

  it("maps warped audio content through the warp map, not the beat grid", () => {
    // The first warp marker sits at beat 2, so content beat 4 plays sample
    // second 1, not the 2 s beat 4 is at 120 BPM. The Layers app ignored
    // warp markers here, but Live plays the warped time, so keep it.
    const warped = audioClip({
      loop: {
        loopStart: 4,
        loopEnd: 8,
        startRelative: 0,
        loopOn: false,
        hiddenLoopStart: 0,
        hiddenLoopEnd: 8,
      },
      warpMarkers: [
        { secTime: 0, beatTime: 2 },
        { secTime: 0.5, beatTime: 3 },
      ],
    });
    const { session } = convertAls(doc([videoTrack({ clips: [warped] })]));
    assert.equal(session.clips?.[0].clipStart, 30);
  });

  it("places audio, MIDI and ZVID Capture clips at their file frames", () => {
    const midi = audioClip({
      kind: "midi",
      currentStart: 4,
      currentEnd: 8,
      loop: {
        loopStart: 1,
        loopEnd: 5,
        startRelative: 0,
        loopOn: false,
        hiddenLoopStart: 0,
        hiddenLoopEnd: 5,
      },
      warpMarkers: [],
      sample: null,
    });
    const audio = audioClip({
      currentStart: 4,
      currentEnd: 8,
      loop: { ...midi.loop, loopStart: 2, loopEnd: 6, hiddenLoopEnd: 8 },
    });
    // Song time 0 is 1.5 s (45 frames) into the take's file.
    const zvid = (id: number, kind: AlsTrack["kind"], clip: AlsClip) =>
      videoTrack({
        id,
        kind,
        clips: [clip],
        captureDevice: "zvid-capture",
        layers: {
          version: "1",
          recordRoot: "project",
          recordings: [
            {
              filename: "zvid.mp4",
              dimensions: [640, 480],
              fps: [30, 1],
              frameStart: -45,
              fileOffsetSec: 1.5,
              transportStartSec: 0,
              transportStartBeats: 0,
              durationSec: 20,
              createdAt: "",
            },
          ],
        } as ZvidCaptureState,
      });
    const { session } = convertAls(
      doc([
        videoTrack({ clips: [audio] }),
        videoTrack({ id: 6, kind: "midi", clips: [midi] }),
        zvid(7, "audio", audio),
        zvid(8, "midi", midi),
      ]),
    );
    assert.deepEqual(
      session.clips?.map(({ id, clipStart, captureOffset }) => [
        id,
        clipStart,
        captureOffset,
        (clipStart ?? 0) + (captureOffset ?? 0),
      ]),
      [
        // Content beat 2 is sample second 1, in take-1 from frame 12.
        ["5-1", 30, 12, 42],
        // Content beat 1, in take-1 from frame 12.
        ["6-1", 15, 12, 27],
        // Sample second 0 was recorded at song time 0, 45 frames into the
        // file, so sample second 1 is at frame 75.
        ["7-1", 30, 45, 75],
        // Song-anchored: arrangement beat 4 (2 s) is 3.5 s into the file.
        ["8-1", 15, 90, 105],
      ],
    );
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
    // Live plays it at native speed, so the player must not follow the
    // markers it keeps.
    assert.ok(unwarped.warpMarkers.length > 0);
    assert.deepEqual(session.clips?.[0].warpMarkers, []);
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

describe("matchZvidTake", () => {
  const take = (
    overrides: Partial<ZvidCaptureTake> & { filename: string },
  ): ZvidCaptureTake => ({
    dimensions: [1920, 1080],
    fps: [30, 1],
    frameStart: 0,
    fileOffsetSec: 0,
    transportStartSec: 0,
    transportStartBeats: 0,
    durationSec: 10,
    createdAt: "2026-09-25T20:00:00Z",
    ...overrides,
  });

  it("picks the take that overlaps the clip the most", () => {
    const takes = [
      take({ filename: "a", transportStartSec: 0, durationSec: 4 }),
      take({ filename: "b", transportStartSec: 3, durationSec: 10 }),
      take({ filename: "c", transportStartSec: 20, durationSec: 10 }),
    ];
    assert.equal(matchZvidTake(takes, 2, 8)?.filename, "b");
    assert.equal(matchZvidTake(takes, 0, 3.5)?.filename, "a");
    assert.equal(matchZvidTake(takes, 19, 40)?.filename, "c");
  });

  it("prefers the latest createdAt on a tie", () => {
    const takes = [
      take({ filename: "late", createdAt: "2026-09-25T21:00:00Z" }),
      take({ filename: "early", createdAt: "2026-09-25T20:00:00Z" }),
      take({ filename: "undated", createdAt: "" }),
    ];
    assert.equal(matchZvidTake(takes, 1, 5)?.filename, "late");
  });

  it("ignores unanchored takes and takes that do not overlap", () => {
    const takes = [
      take({ filename: "loose", transportStartSec: null, durationSec: 100 }),
      take({ filename: "before", transportStartSec: 0, durationSec: 2 }),
    ];
    assert.equal(matchZvidTake(takes, 2, 6), undefined);
    assert.equal(matchZvidTake([], 0, 1), undefined);
  });

  it("picks the overlapping take that best fits the clip's sample", () => {
    const takes = [
      take({ filename: "long", durationSec: 25.39 }),
      take({
        filename: "short",
        durationSec: 9.72,
        createdAt: "2026-09-25T21:00:00Z",
      }),
      take({ filename: "later", transportStartSec: 30, durationSec: 20 }),
    ];
    // Content 0–9 s overlaps both takes at 0 equally.
    assert.equal(matchZvidTake(takes, 0, 9, [0, 25.4])?.filename, "long");
    assert.equal(matchZvidTake(takes, 0, 9, [0, 9.7])?.filename, "short");
    // Without the sample, the tie goes to the latest take.
    assert.equal(matchZvidTake(takes, 0, 9)?.filename, "short");
    // Only takes that overlap the content itself are candidates.
    assert.equal(matchZvidTake(takes, 12, 20, [0, 50])?.filename, "long");
  });
});

describe("convertAls with ZVID Capture fixtures", () => {
  const load = async (name: string) =>
    convertAls(await parseAls(new Uint8Array(fixture(name))));
  // The file frame each clip starts at.
  const fileFrame = (clip: LvpClip) =>
    (clip.clipStart ?? 0) + (clip.captureOffset ?? 0);
  const placed = (result: AlsImportResult) =>
    result.session.clips?.map((clip) => [
      clip.id,
      clip.filePath,
      clip.frameStart,
      fileFrame(clip),
    ]);

  it("maps each VST3 clip to the take it overlaps, one entry per take", async () => {
    const result = await load("zvid-capture-vst3.xml");
    assert.deepEqual(placed(result), [
      ["20-1", "video-01-9-25-20-36-12-0.mp4", 0, 45],
      ["20-2", "video-01-9-25-20-36-12-0.mp4", 480, 600],
    ]);
    // The unanchored take is not a source-track entry.
    assert.deepEqual(result.session.tracks, [
      {
        id: "20",
        name: "Cam A",
        recordings: [
          { filename: "video-01-9-25-20-36-12-0.mp4", frameStart: -45 },
          { filename: "video-01-9-25-20-36-12-0.mp4", frameStart: -120 },
        ],
      },
    ]);
    assert.deepEqual(result.summary.skipped, [
      {
        trackId: "20",
        trackName: "Cam A",
        clipId: "20-3",
        clipName: "Outro",
        reason: "no-take",
      },
    ]);
    assert.deepEqual(result.summary.recordRoots, {
      "video-01-9-25-20-36-12-0.mp4": "project",
    });
    assert.equal(result.summary.hasLayersVideo, true);
  });

  it("breaks AU overlap ties by the latest take", async () => {
    const result = await load("zvid-capture-au.xml");
    assert.deepEqual(placed(result), [
      ["21-1", "video-01-9-25-21-00-00-0.mp4", 0, 15],
      ["21-2", "video-02-9-25-21-05-00-0.mp4", 60, 30],
    ]);
    assert.equal(result.session.timeline?.canvasWidth, 1280);
    assert.deepEqual(result.summary.recordRoots, {
      "video-01-9-25-21-00-00-0.mp4": "documents",
      "video-02-9-25-21-05-00-0.mp4": "documents",
    });
  });

  it("imports a Layers Record track and a ZVID Capture track together", async () => {
    const result = await load("layers-and-zvid-capture.xml");
    assert.deepEqual(placed(result), [
      // Layers Record keeps playing its last recording.
      ["8-1", "video-12-13-23-20-15-14-1.mp4", 0, 57],
      ["20-1", "video-01-9-25-20-36-12-0.mp4", 0, 45],
      ["20-2", "video-01-9-25-20-36-12-0.mp4", 480, 600],
    ]);
    assert.deepEqual(
      result.session.tracks?.map((track) => track.recordings?.length),
      [2, 2],
    );
    assert.deepEqual(
      result.session.mainTracks?.map((track) => track.name),
      ["Layers", "Cam A"],
    );
    assert.deepEqual(result.summary.recordRoots, {
      "video-01-9-25-20-36-12-0.mp4": "project",
    });
    // Only the Layers Record track's clips are end-aligned after probing.
    assert.deepEqual(result.summary.layersRecordTracks, ["8"]);
  });

  it("keeps trimmed and moved clips on the take their content was recorded in", async () => {
    const result = await load("zvid-capture-trimmed.xml");
    // The take starts 1.5 s (45 frames) into its file at song time 0. Each
    // clip plays the file from where its content was recorded, not from
    // where it sits in the arrangement or where it starts in its sample.
    assert.deepEqual(
      result.session.clips?.map((clip) => [
        clip.id,
        clip.filePath,
        clip.frameStart,
        clip.frameCount,
        fileFrame(clip),
      ]),
      [
        // Resized at its end: content from beat 0, recorded at 0 s.
        ["1-1", "video-01-9-28-15-01-28-0.mp4", 0, 240, 45],
        // Start marker at bar 9 (beat 32), recorded at 16 s.
        ["1-2", "video-01-9-28-15-01-28-0.mp4", 240, 360, 525],
        // Moved to beat 200, past the take, with content from beat 60 (30 s).
        ["1-3", "video-01-9-28-15-01-28-0.mp4", 3000, 120, 945],
      ],
    );
    assert.deepEqual(result.summary.skipped, []);
  });

  describe("with two takes anchored at song time 0 (zvid2.als)", () => {
    const VIDEO_01 = "video-01-9-28-16-58-36-0.mp4";
    const VIDEO_02 = "video-02-9-28-16-59-30-0.mp4";
    const takesOf = (result: AlsImportResult) =>
      result.session.clips?.map((clip) => [
        clip.id,
        clip.filePath,
        fileFrame(clip),
      ]);

    it("converts all nine clips, each with the take of its sample", async () => {
      const result = await load("zvid2-rearranged.xml");
      assert.deepEqual(takesOf(result), [
        // The 9.7 s sample overlaps both takes; the 9.72 s take fits it.
        ["8-1", VIDEO_02, 0],
        // Start marker at bar 9 (beat 32, 16 s).
        ["8-8", VIDEO_01, 480],
        ["8-9", VIDEO_01, 480],
        ["8-10", VIDEO_01, 480],
        ["8-11", VIDEO_01, 480],
        ["8-3", VIDEO_01, 486],
        // Content from beat 19.4 (9.7 s), which both takes cover.
        ["8-4", VIDEO_01, 291],
        ["8-5", VIDEO_01, 291],
        ["8-6", VIDEO_01, 291],
      ]);
      assert.deepEqual(result.summary.skipped, []);
    });

    it("keeps each rearranged clip on its own take", async () => {
      const doc = await parseAls(
        new Uint8Array(fixture("zvid2-rearranged.xml")),
      );
      const clips = doc.tracks[0].clips;
      // The short sample's clip moves far past both takes, and a clip of the
      // long sample from its start takes its place, where both takes overlap
      // its content equally.
      const short = clips.find((clip) => clip.id === 1) as AlsClip;
      Object.assign(short, { currentStart: 200, currentEnd: 219.41 });
      const long = clips.find((clip) => clip.id === 8) as AlsClip;
      Object.assign(long, { currentStart: 0, currentEnd: 18.8 });
      Object.assign(long.loop, { loopStart: 0, loopEnd: 18.8 });
      const result = convertAls(doc);
      const byId = new Map(
        takesOf(result)?.map((entry) => [entry[0], entry.slice(1)]),
      );
      assert.deepEqual(byId.get("8-1"), [VIDEO_02, 0]);
      assert.deepEqual(byId.get("8-8"), [VIDEO_01, 0]);
      assert.deepEqual(result.summary.skipped, []);
    });
  });

  it("offsets a clip into its take's file, not its sample", async () => {
    const result = await load("zvid-capture-vst3.xml");
    // Chorus plays content from beat 32 (16 s), where take a2 is 20 s into
    // its file; Verse plays from 0 s, 1.5 s into take a1. `clipStart` and
    // `frameHiddenLoopEnd` stay in sample frames, and `captureOffset` is the
    // file frame of sample second 0.
    assert.deepEqual(
      result.session.clips?.map(
        ({ id, clipStart, captureOffset, frameHiddenLoopEnd }) => [
          id,
          clipStart,
          captureOffset,
          frameHiddenLoopEnd,
        ],
      ),
      [
        ["20-1", 0, 45, 240],
        ["20-2", 480, 120, 660],
      ],
    );
  });

  it("resolves each take against its own record root", async () => {
    const doc = await parseAls(
      new Uint8Array(fixture("zvid-capture-vst3.xml")),
    );
    const [track] = doc.tracks;
    const state = track.layers as ZvidCaptureState;
    // Recorded to Documents before the set was saved, then to the set.
    track.layers = {
      ...state,
      recordRoot: "project",
      recordings: state.recordings.map((take, index) => ({
        ...take,
        filename: `video-0${index + 1}.mp4`,
        recordRoot: index === 0 ? "documents" : "project",
      })),
    } as ZvidCaptureState;
    const { summary } = convertAls(doc);
    assert.deepEqual(summary.recordRoots, {
      "video-01.mp4": "documents",
      "video-02.mp4": "project",
    });
  });

  it("skips a ZVID Capture track whose takes are all unanchored", async () => {
    const doc = await parseAls(
      new Uint8Array(fixture("zvid-capture-vst3.xml")),
    );
    const [track] = doc.tracks;
    const state = track.layers as ZvidCaptureState;
    track.layers = {
      ...state,
      recordings: state.recordings.filter(
        (recording) => recording.transportStartSec === null,
      ),
    } as ZvidCaptureState;
    const { session, summary } = convertAls(doc);
    assert.deepEqual(session.clips, []);
    assert.deepEqual(session.tracks?.[0].recordings, []);
    assert.deepEqual(
      summary.skipped.map((clip) => clip.reason),
      ["no-recording", "no-recording", "no-recording"],
    );
    assert.equal(summary.recordRoots, undefined);
  });
});
