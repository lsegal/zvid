import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AUDIO_ROW_COLLAPSED_STORAGE_KEY,
  audioRowToggleLabel,
  readAudioRowCollapsed,
  writeAudioRowCollapsed,
} from "./audio-row-section.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const audioRowTsx = readFileSync(
  new URL("./components/timeline/AudioRow.tsx", import.meta.url),
  "utf8",
);
const audioRowCss = readFileSync(
  new URL("./components/timeline/audio-row.css", import.meta.url),
  "utf8",
);

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("audio row section", () => {
  it("persists the collapsed preference", () => {
    const storage = memoryStorage();
    assert.equal(readAudioRowCollapsed(storage), false);
    writeAudioRowCollapsed(storage, true);
    assert.equal(storage.getItem(AUDIO_ROW_COLLAPSED_STORAGE_KEY), "true");
    assert.equal(readAudioRowCollapsed(storage), true);
    writeAudioRowCollapsed(storage, false);
    assert.equal(readAudioRowCollapsed(storage), false);
  });

  it("tolerates unavailable storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readAudioRowCollapsed(broken), false);
    assert.equal(readAudioRowCollapsed(undefined), false);
    assert.doesNotThrow(() => writeAudioRowCollapsed(broken, true));
  });

  it("labels the toggle with what it does", () => {
    assert.equal(audioRowToggleLabel(false), "Hide audio waveform");
    assert.equal(audioRowToggleLabel(true), "Show audio waveform");
  });

  it("ends the timeline, after the source tracks", () => {
    const timeline = appTsx.slice(
      appTsx.indexOf("<Timeline"),
      appTsx.indexOf("</Timeline>"),
    );
    const audio = timeline.indexOf("<AudioRow");
    assert.notEqual(audio, -1, "missing Audio row");
    assert.ok(audio > timeline.indexOf("<ArrangementLanes"));
    assert.ok(audio > timeline.indexOf("<SourceTracks"));
    assert.doesNotMatch(timeline.slice(audio + 1), /<[A-Z]/);
  });

  it("pins to the bottom of the timeline", () => {
    const rule = audioRowCss.match(/\.track-row--bus \{[^}]*\}/)?.[0] ?? "";
    assert.match(rule, /position: sticky;/);
    assert.match(rule, /bottom: 0;/);
    assert.match(rule, /background: #/, "the pinned row must be opaque");
  });

  it("exposes the toggle state to assistive tech", () => {
    const start = audioRowTsx.indexOf('className="audio-row__toggle"');
    assert.notEqual(start, -1, "missing Audio row toggle");
    const toggle = audioRowTsx.slice(
      audioRowTsx.lastIndexOf("<button", start),
      start,
    );
    assert.match(toggle, /aria-expanded=\{!isCollapsed\}/);
  });
});
