import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GRANULAR_EFFECT_NAME } from "../fx/effects/granular/granular.ts";
import {
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { createEffect } from "../fx/stack/ops.ts";
import { DEFAULT_SYNTH_PARAMS } from "../midi-clip.ts";
import { createSynthEffect } from "../midi-effects.ts";
import {
  type ArmedAuditionSession,
  combineVoices,
  keyTrackIds,
  trackInstruments,
} from "./armed-audition.ts";

const synth = (trackId: string, cutoff: number) =>
  createSynthEffect(sourceTrackEffectTrackId(trackId), {
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
  exceptSpanId?: string,
) {
  return trackInstruments(new Set(armed), session, exceptSpanId).map(
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
      [synth("a", 100), synth("b", 200), synth("c", 300)],
    );
    assert.deepEqual(cutoffs(["a", "c"], session), [100, 300]);
    assert.deepEqual(cutoffs([], session), []);
  });

  it("resolves other kinds of instrument too", () => {
    const session = sessionOf(
      [{ id: "a" }],
      [span("m", "a", 0)],
      [createEffect(sourceTrackEffectTrackId("a"), GRANULAR_EFFECT_NAME)],
    );
    assert.deepEqual(cutoffs(["a"], session), ["granular"]);
  });

  it("plays a track's instrument with no clips at all", () => {
    assert.deepEqual(
      cutoffs(["a"], sessionOf([{ id: "a" }], [], [synth("a", 100)])),
      [100],
    );
  });

  it("leaves out a track with no instrument", () => {
    const session = sessionOf(
      [{ id: "empty" }, { id: "plain" }],
      [span("m", "plain", 0)],
      [],
    );
    assert.deepEqual(cutoffs(["empty", "plain"], session), []);
  });

  it("leaves out a track with its FX switched off", () => {
    const session = sessionOf(
      [{ id: "a", fxEnabled: false }],
      [span("m", "a", 0)],
      [synth("a", 100)],
    );
    assert.deepEqual(cutoffs(["a"], session), []);
  });

  it("takes the track's instrument, not a clip's (#1626)", () => {
    const clipSynth = createSynthEffect(sourceClipEffectTrackId("m"), {
      ...DEFAULT_SYNTH_PARAMS,
      cutoff: 800,
    });
    assert.deepEqual(
      cutoffs(
        ["a"],
        sessionOf([{ id: "a" }], [span("m", "a", 0)], [clipSynth]),
      ),
      [],
    );
    assert.deepEqual(
      cutoffs(
        ["a"],
        sessionOf(
          [{ id: "a" }],
          [span("m", "a", 0)],
          [clipSynth, synth("a", 100)],
        ),
      ),
      [100],
    );
  });

  it("leaves out the track owning the excepted clip", () => {
    const session = sessionOf(
      [{ id: "a" }, { id: "b" }],
      [span("m1", "a", 0), span("m2", "b", 0)],
      [synth("a", 100), synth("b", 200)],
    );
    assert.deepEqual(cutoffs(["a", "b"], session, "m1"), [200]);
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
