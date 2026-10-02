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
    assert.equal(audioRowToggleLabel(false), "Collapse audio row");
    assert.equal(audioRowToggleLabel(true), "Expand audio row");
  });

  it("is the timeline's docked footer, outside its scrolling rows", () => {
    const timeline = appTsx.slice(
      appTsx.indexOf("<Timeline"),
      appTsx.indexOf("</Timeline>"),
    );
    const footer = timeline.indexOf("footer={");
    const audio = timeline.indexOf("<AudioRow");
    assert.notEqual(footer, -1, "missing Timeline footer");
    assert.ok(audio > footer, "the Audio row must be the footer");
    assert.ok(audio < timeline.indexOf("<Ruler"), "and not a scrolling row");
    assert.equal(timeline.lastIndexOf("<AudioRow"), audio);
    // Docked at any panel height, so nothing pins it conditionally.
    assert.doesNotMatch(audioRowTsx, /isPinned/);
    assert.doesNotMatch(audioRowCss, /sticky|--bus-pinned|margin-top: auto/);
    const row = audioRowCss.match(/\.track-row--bus \{[^}]*\}/)?.[0] ?? "";
    assert.match(row, /background: #/, "the footer row must be opaque");
  });

  it("draws the waveform collapsed too", () => {
    const body = audioRowTsx.slice(audioRowTsx.indexOf("return ("));
    assert.doesNotMatch(body, /isCollapsed \?\s*\(/);
    assert.match(body, /<MainWaveform/);
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
