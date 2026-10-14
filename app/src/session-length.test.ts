import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INITIAL_PROJECT_STATE } from "./app/constants.ts";
import { sessionToProject } from "./app/session-project.ts";
import {
  getSessionLengthQ,
  getTimelineContentEndQ,
} from "./app/timeline-math.ts";
import type { ArrangementClip, ProjectState, SourceSpan } from "./app/types.ts";
import { audioMixEndSeconds } from "./audio-mix/mix.ts";
import { resolveAudioClips } from "./audio-mix/resolve.ts";
import { synthVoices } from "./audio-mix/synth.ts";
import { defaultExportRange } from "./export-options.ts";
import { sourceClipEffectTrackId } from "./fx/stack/clip-stacks.ts";
import { DEFAULT_SYNTH_PARAMS } from "./midi-clip.ts";
import { createSynthEffect } from "./midi-effects.ts";
import { resolveRenderClips } from "./render-clips.ts";
import { projectToSession } from "./session-save.ts";
import {
  applySessionLength,
  applySessionSettings,
  sessionSettingsFromProject,
} from "./session-settings.ts";

// At 120 BPM one quarter is half a second.
const BPM = 120;
const BAR = 4;

// A MIDI clip from quarter 8 to 12, its last note held to its end, through
// a Synth that releases over 2 seconds.
const midiSpan: SourceSpan = {
  id: "m",
  sourceTrackId: "keys",
  label: "Keys",
  mediaPath: "",
  tint: "",
  accent: "",
  startQ: 8,
  durationSeconds: 2,
  trimStartSeconds: 0,
  notes: [{ pitch: 60, start: 0, length: 4, velocity: 100 }],
};
const keys = { id: "keys" };
const synth = createSynthEffect(sourceClipEffectTrackId("m"), {
  ...DEFAULT_SYNTH_PARAMS,
  release: 2,
});

function sessionOf(clips: ArrangementClip[], sourceSpans: SourceSpan[]) {
  const sourceTracks = [keys];
  const render = resolveRenderClips({
    clips,
    lanes: [{ id: "lane-1", name: "Layer 1", colorIndex: 0 }],
    sourceTracks: sourceTracks.map((track) => ({
      ...track,
      name: "Keys",
      colorIndex: 0,
      recordingPaths: [],
    })),
    sourceSpans,
    bpm: BPM,
    effects: [],
  });
  const audio = resolveAudioClips({
    clips,
    lanes: [{ id: "lane-1" }],
    sourceTracks,
    sourceSpans,
    mediaById: new Map(),
    effects: [synth],
    bpm: BPM,
  });
  return {
    timelineEndQ: getTimelineContentEndQ(clips, sourceSpans, BPM, BAR),
    exportRange: defaultExportRange({
      clips: render.clips,
      bpm: BPM,
      fps: 30,
      audioClips: audio.clips,
    }),
    audioEndQ: (audioMixEndSeconds(audio) * BPM) / 60,
    audio,
  };
}

describe("MIDI clips and session length", () => {
  it("cover a MIDI-only session's timeline, export range and audio", () => {
    const session = sessionOf([], [midiSpan]);
    assert.equal(session.timelineEndQ, 12);
    assert.deepEqual(session.exportRange, { inQ: 8, outQ: 12 });
    assert.equal(session.audioEndQ, 12);
  });

  it("cut a held note's release tail at the clip's end", () => {
    const { synth } = sessionOf([], [midiSpan]).audio.clips[0];
    assert.ok(synth);
    // The release would sound 2 seconds past the clip's end...
    const [voice] = synthVoices(synth.notes, synth.params, BPM);
    assert.equal(voice.stopSeconds, 4);
    // ...but the synth renders only the clip's window, so nothing sounds
    // past the end the session length already covers.
    assert.equal(synth.durationSeconds, 2);
  });

  it("extend the export range past layers that draw only text", () => {
    const text: ArrangementClip = {
      id: "t",
      sourceSpanId: "",
      sourceTrackId: "",
      laneId: "lane-1",
      label: "Title",
      mediaPath: "",
      kind: "text",
      startQ: 0,
      durationSeconds: 1,
      trimStartSeconds: 0,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: 1,
      tint: "",
      accent: "",
    };
    const session = sessionOf([text], [midiSpan]);
    assert.equal(session.timelineEndQ, 12);
    assert.deepEqual(session.exportRange, { inQ: 0, outQ: 12 });
    assert.equal(session.audioEndQ, 12);
  });
});

describe("session length override", () => {
  const project: ProjectState = {
    ...INITIAL_PROJECT_STATE,
    bpm: BPM,
    fps: 30,
    sourceSpans: [midiSpan],
  };

  it("drives the timeline end, longer or shorter than the content", () => {
    assert.equal(
      getTimelineContentEndQ(
        [],
        [midiSpan],
        BPM,
        BAR,
        getSessionLengthQ(600, 30, BPM),
      ),
      40,
    );
    assert.equal(getTimelineContentEndQ([], [midiSpan], BPM, BAR, 6), 6);
  });

  it("is set in frames and unset back to the detected end", () => {
    const set = applySessionLength(project, 40);
    // 40 quarters at 120 BPM is 20 s, 600 frames at 30 fps.
    assert.equal(set.projectDurationFrames, 600);
    assert.equal(getSessionLengthQ(set.projectDurationFrames, 30, BPM), 40);
    assert.equal(applySessionLength(set, 40), set);
    const unset = applySessionLength(set, undefined);
    assert.equal(unset.projectDurationFrames, undefined);
    assert.equal(applySessionLength(unset, undefined), unset);
  });

  it("survives a frame rate change and save and load", () => {
    const set = applySessionLength(project, 40);
    const at60 = applySessionLength(
      applySessionSettings(set, {
        ...sessionSettingsFromProject(set),
        fps: 60,
      }),
      40,
    );
    assert.equal(at60.projectDurationFrames, 1200);
    const loaded = sessionToProject(
      JSON.parse(JSON.stringify(projectToSession(at60, { playheadQ: 0 }))),
      [],
    );
    assert.equal(loaded.projectDurationFrames, 1200);
    assert.equal(
      getSessionLengthQ(loaded.projectDurationFrames, loaded.fps, loaded.bpm),
      40,
    );
  });
});
