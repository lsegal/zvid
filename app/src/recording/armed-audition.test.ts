import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRANULAR_EFFECT_NAME } from "../fx/effects/granular/granular.ts";
import { sourceClipEffectTrackId } from "../fx/stack/clip-stacks.ts";
import { createEffect } from "../fx/stack/ops.ts";
import { DEFAULT_SYNTH_PARAMS } from "../midi-clip.ts";
import { createSynthEffect } from "../midi-effects.ts";
import {
  type ArmedAuditionSession,
  combineVoices,
  keyTrackIds,
  trackInstruments,
} from "./armed-audition.ts";

const synth = (spanId: string, cutoff: number) =>
  createSynthEffect(sourceClipEffectTrackId(spanId), {
    ...DEFAULT_SYNTH_PARAMS,
    cutoff,
  });
const span = (
  id: string,
  sourceTrackId: string,
  startQ: number,
  notes = true,
) => ({
  id,
  sourceTrackId,
  startQ,
  ...(notes ? { notes: [] } : {}),
});

function sessionOf(
  sourceTracks: { id: string; fxEnabled?: boolean }[],
  sourceSpans: ReturnType<typeof span>[],
  effects: ArmedAuditionSession["effects"],
) {
  return { sourceTracks, sourceSpans, effects } as ArmedAuditionSession;
}

function cutoffs(
  armed: string[],
  session: ArmedAuditionSession,
  playheadQ = 0,
  exceptSpanId?: string,
) {
  return trackInstruments(new Set(armed), session, playheadQ, exceptSpanId).map(
    (instrument) =>
      instrument.kind === "synth" ? instrument.params.cutoff : instrument.kind,
  );
}

describe("keyTrackIds", () => {
  it("is the armed tracks, leaving the selected track out", () => {
    assert.deepEqual([...keyTrackIds(new Set(["a"]), "b")], ["a"]);
  });

  it("falls back to the selected track with none armed", () => {
    assert.deepEqual([...keyTrackIds(new Set(), "b")], ["b"]);
    assert.deepEqual([...keyTrackIds(new Set(), undefined)], []);
  });
});

describe("trackInstruments", () => {
  it("gives every armed track's instrument, and only theirs", () => {
    const session = sessionOf(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [span("m1", "a", 0), span("m2", "b", 0), span("m3", "c", 0)],
      [synth("m1", 100), synth("m2", 200), synth("m3", 300)],
    );
    assert.deepEqual(cutoffs(["a", "c"], session), [100, 300]);
    assert.deepEqual(cutoffs([], session), []);
  });

  it("resolves other kinds of instrument too", () => {
    const session = sessionOf(
      [{ id: "a" }],
      [span("m", "a", 0)],
      [createEffect(sourceClipEffectTrackId("m"), GRANULAR_EFFECT_NAME)],
    );
    assert.deepEqual(cutoffs(["a"], session), ["granular"]);
  });

  it("leaves out a track with no instrument, on no MIDI clip", () => {
    const session = sessionOf(
      [{ id: "empty" }, { id: "plain" }, { id: "media" }],
      [span("m", "plain", 0), span("v", "media", 0, false)],
      [synth("v", 100)],
    );
    assert.deepEqual(cutoffs(["empty", "plain", "media"], session), []);
  });

  it("leaves out a track with its FX switched off", () => {
    const session = sessionOf(
      [{ id: "a", fxEnabled: false }],
      [span("m", "a", 0)],
      [synth("m", 100)],
    );
    assert.deepEqual(cutoffs(["a"], session), []);
  });

  it("plays the clip at or last before the playhead, else the first", () => {
    const session = sessionOf(
      [{ id: "a" }],
      [span("late", "a", 8), span("early", "a", 4), span("bare", "a", 6)],
      [synth("late", 800), synth("early", 400)],
    );
    assert.deepEqual(cutoffs(["a"], session, 0), [400]);
    assert.deepEqual(cutoffs(["a"], session, 4), [400]);
    assert.deepEqual(cutoffs(["a"], session, 7), [400]);
    assert.deepEqual(cutoffs(["a"], session, 8), [800]);
  });

  it("leaves out the track owning the excepted clip", () => {
    const session = sessionOf(
      [{ id: "a" }, { id: "b" }],
      [span("m1", "a", 0), span("m2", "b", 0)],
      [synth("m1", 100), synth("m2", 200)],
    );
    assert.deepEqual(cutoffs(["a", "b"], session, 0, "m1"), [200]);
  });
});

describe("combineVoices", () => {
  it("drops missing voices and passes a lone voice through", () => {
    const voice = { update() {}, hold() {}, release() {} };
    assert.equal(combineVoices([undefined, undefined]), undefined);
    assert.equal(combineVoices([undefined, voice]), voice);
  });

  it("fans out to every voice", () => {
    const calls: string[] = [];
    const voice = (name: string) => ({
      update: () => calls.push(`${name} update`),
      hold: () => calls.push(`${name} hold`),
      release: () => calls.push(`${name} release`),
    });
    const both = combineVoices([voice("a"), voice("b")]);
    both?.hold();
    both?.update({ bend: 0 });
    both?.release();
    assert.deepEqual(calls, [
      "a hold",
      "b hold",
      "a update",
      "b update",
      "a release",
      "b release",
    ]);
  });
});
