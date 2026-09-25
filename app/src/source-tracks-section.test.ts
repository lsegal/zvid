import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  formatSourceTracksSummary,
  isSourceTracksSectionCollapsed,
  readSourceTracksCollapsed,
  SOURCE_TRACKS_COLLAPSED_STORAGE_KEY,
  writeSourceTracksCollapsed,
} from "./source-tracks-section.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("source tracks section", () => {
  it("persists the collapsed preference", () => {
    const storage = memoryStorage();
    assert.equal(readSourceTracksCollapsed(storage), false);
    writeSourceTracksCollapsed(storage, true);
    assert.equal(storage.getItem(SOURCE_TRACKS_COLLAPSED_STORAGE_KEY), "true");
    assert.equal(readSourceTracksCollapsed(storage), true);
    writeSourceTracksCollapsed(storage, false);
    assert.equal(readSourceTracksCollapsed(storage), false);
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
    assert.equal(readSourceTracksCollapsed(broken), false);
    assert.equal(readSourceTracksCollapsed(undefined), false);
    assert.doesNotThrow(() => writeSourceTracksCollapsed(broken, true));
  });

  it("only collapses when there are tracks to hide", () => {
    assert.equal(isSourceTracksSectionCollapsed(true, 3), true);
    assert.equal(isSourceTracksSectionCollapsed(true, 0), false);
    assert.equal(isSourceTracksSectionCollapsed(false, 3), false);
  });

  it("summarizes the hidden track count", () => {
    assert.equal(formatSourceTracksSummary(1), "1 track");
    assert.equal(formatSourceTracksSummary(3), "3 tracks");
  });

  it("exposes the toggle state to assistive tech", () => {
    const start = appTsx.indexOf('className="source-header__toggle"');
    assert.notEqual(start, -1, "missing source tracks toggle");
    const toggle = appTsx.slice(appTsx.lastIndexOf("<button", start), start);
    assert.match(toggle, /aria-expanded=\{!isSourceTracksCollapsed\}/);
  });

  it("keeps the collapsed header a new-track drop target", () => {
    assert.match(
      appTsx,
      /data-source-track-drop-target=\{\s*isSourceHeaderDropTarget \? "new-track" : undefined\s*\}/,
    );
  });
});
