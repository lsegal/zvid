import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_RECORD_SOURCE_PREFS,
  RECORD_SOURCE_STORAGE_KEY,
  readRecordSourcePrefs,
  resolveRecordSource,
} from "./record-source.ts";

const stored = (value: string | null) => ({
  getItem: (key: string) => (key === RECORD_SOURCE_STORAGE_KEY ? value : null),
  setItem: () => {},
});

test("video and audio is the default", () => {
  assert.deepEqual(
    readRecordSourcePrefs(undefined),
    DEFAULT_RECORD_SOURCE_PREFS,
  );
  assert.equal(DEFAULT_RECORD_SOURCE_PREFS.source, "media");
  assert.equal(DEFAULT_RECORD_SOURCE_PREFS.quantize, "off");
});

test("reads what was saved and ignores what it doesn't know", () => {
  assert.deepEqual(
    readRecordSourcePrefs(
      stored(
        JSON.stringify({
          source: "midi",
          midiInput: "keyboard",
          quantize: "1/8T",
        }),
      ),
    ),
    { source: "midi", midiInput: "keyboard", quantize: "1/8T" },
  );
  assert.deepEqual(
    readRecordSourcePrefs(
      stored(JSON.stringify({ source: "x", midiInput: 1, quantize: "1/64" })),
    ),
    DEFAULT_RECORD_SOURCE_PREFS,
  );
  assert.deepEqual(
    readRecordSourcePrefs(stored("{")),
    DEFAULT_RECORD_SOURCE_PREFS,
  );
});

test("with MIDI off recording captures video and audio, whatever was chosen", () => {
  const prefs = { ...DEFAULT_RECORD_SOURCE_PREFS, source: "midi" as const };
  assert.equal(resolveRecordSource(prefs, true), "midi");
  assert.equal(resolveRecordSource(prefs, false), "media");
  assert.equal(resolveRecordSource(DEFAULT_RECORD_SOURCE_PREFS, true), "media");
});
