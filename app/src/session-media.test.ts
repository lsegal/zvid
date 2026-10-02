import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaAvailability } from "./media.ts";
import {
  type OfflineSessionMediaOptions,
  offlineSessionMediaIds,
} from "./session-media.ts";

function options(
  availability: Record<string, MediaAvailability>,
  overrides: Partial<OfflineSessionMediaOptions> = {},
): OfflineSessionMediaOptions {
  return {
    availability: (mediaId) => availability[mediaId],
    clips: [],
    sourceSpans: [],
    playheadQ: 0,
    visibleStartQ: 0,
    visibleEndQ: 16,
    ...overrides,
  };
}

describe("offlineSessionMediaIds", () => {
  it("includes media that is only on source tracks", () => {
    assert.deepEqual(
      offlineSessionMediaIds(
        options(
          { take: "offline" },
          { sourceSpans: [{ mediaId: "take", startQ: 0, endQ: 4 }] },
        ),
      ),
      ["take"],
    );
  });

  it("skips media that is ready, hydrating or unknown", () => {
    assert.deepEqual(
      offlineSessionMediaIds(
        options(
          { a: "hydrating", b: "ready" },
          {
            clips: [
              { mediaId: "a", startQ: 0, endQ: 4 },
              { mediaId: "b", startQ: 0, endQ: 4 },
              { mediaId: "missing", startQ: 0, endQ: 4 },
              { startQ: 0, endQ: 4 },
            ],
          },
        ),
      ),
      [],
    );
  });

  it("lists each media once", () => {
    assert.deepEqual(
      offlineSessionMediaIds(
        options(
          { a: "offline" },
          {
            clips: [
              { mediaId: "a", startQ: 0, endQ: 4 },
              { mediaId: "a", startQ: 8, endQ: 12 },
            ],
            sourceSpans: [{ mediaId: "a", startQ: 0, endQ: 12 }],
          },
        ),
      ),
      ["a"],
    );
  });

  it("orders the playhead, then visible, then the rest", () => {
    assert.deepEqual(
      offlineSessionMediaIds(
        options(
          {
            far: "offline",
            visible: "offline",
            under: "offline",
            span: "offline",
          },
          {
            playheadQ: 10,
            visibleStartQ: 8,
            visibleEndQ: 24,
            clips: [
              { mediaId: "far", startQ: 64, endQ: 68 },
              { mediaId: "visible", startQ: 20, endQ: 30 },
              // Also under the playhead, which wins over its later use.
              { mediaId: "far", startQ: 9, endQ: 11 },
            ],
            sourceSpans: [
              { mediaId: "under", startQ: 8, endQ: 12 },
              { mediaId: "span", startQ: 0, endQ: 2 },
            ],
          },
        ),
      ),
      ["far", "under", "visible", "span"],
    );
  });
});
