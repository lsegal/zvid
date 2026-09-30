import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCATE_OFFLINE_MEDIA_HINT } from "./constants.ts";
import {
  formatDuration,
  formatHistoryStatus,
  formatSessionMediaCheckStatus,
} from "./format.ts";
import type { SessionMediaCheck } from "./types.ts";

const check = (extra: Partial<SessionMediaCheck> = {}): SessionMediaCheck => ({
  sessionName: "Song",
  pendingIds: new Set(),
  restored: 0,
  offline: 0,
  analyzingFromDisk: false,
  hydratedFromDisk: false,
  overlapNote: "",
  ...extra,
});

describe("formatSessionMediaCheckStatus", () => {
  it("reports a clean load", () => {
    assert.equal(formatSessionMediaCheckStatus(check()), "Loaded Song.");
  });

  it("reports restored and offline media with the overlap note", () => {
    assert.equal(
      formatSessionMediaCheckStatus(
        check({ restored: 2, offline: 1, overlapNote: "Fixed overlaps." }),
      ),
      `Loaded Song. Restored 2 media files from cache. 1 clip is still offline. ${LOCATE_OFFLINE_MEDIA_HINT} Fixed overlaps.`,
    );
  });

  it("reports when everything is offline", () => {
    assert.equal(
      formatSessionMediaCheckStatus(check({ offline: 3 })),
      `Loaded Song. All referenced media is currently offline. ${LOCATE_OFFLINE_MEDIA_HINT}`,
    );
  });
});

describe("formatDuration", () => {
  it("formats minutes, seconds and tenths", () => {
    assert.equal(formatDuration(65.25), "1:05.2");
  });
});

describe("formatHistoryStatus", () => {
  it("names the undone step", () => {
    assert.equal(
      formatHistoryStatus("Undid", "Move clip"),
      "Undid: Move clip.",
    );
  });
});
