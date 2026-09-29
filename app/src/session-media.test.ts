import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaAvailability } from "./media.ts";
import {
  forgetChangedMainAudioMiss,
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
  it("includes offline main audio with no clips referencing it", () => {
    assert.deepEqual(
      offlineSessionMediaIds(
        options({ song: "offline" }, { mainAudioId: "song" }),
      ),
      ["song"],
    );
  });

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
          { song: "ready", a: "hydrating", b: "ready" },
          {
            mainAudioId: "song",
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

  it("orders main audio, then the playhead, then visible, then the rest", () => {
    assert.deepEqual(
      offlineSessionMediaIds(
        options(
          {
            song: "offline",
            far: "offline",
            visible: "offline",
            under: "offline",
            span: "offline",
          },
          {
            mainAudioId: "song",
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
      ["song", "far", "under", "visible", "span"],
    );
  });

  it("puts the main audio first even when a clip uses it too", () => {
    assert.deepEqual(
      offlineSessionMediaIds(
        options(
          { clip: "offline", song: "offline" },
          {
            mainAudioId: "song",
            clips: [
              { mediaId: "clip", startQ: 0, endQ: 4 },
              { mediaId: "song", startQ: 0, endQ: 4 },
            ],
          },
        ),
      ),
      ["song", "clip"],
    );
  });

  it("requests a main audio that a remote update adds", () => {
    const availability = { take: "offline", song: "offline" } as const;
    const before = offlineSessionMediaIds(
      options(availability, {
        clips: [{ mediaId: "take", startQ: 0, endQ: 4 }],
      }),
    );
    const after = offlineSessionMediaIds(
      options(availability, {
        mainAudioId: "song",
        clips: [{ mediaId: "take", startQ: 0, endQ: 4 }],
      }),
    );
    assert.deepEqual(before, ["take"]);
    assert.deepEqual(after, ["song", "take"]);
  });
});

describe("forgetChangedMainAudioMiss", () => {
  it("forgets a miss for a newly added or replaced main audio", () => {
    const misses = new Set(["song", "take"]);
    forgetChangedMainAudioMiss(misses, undefined, "song");
    assert.deepEqual(Array.from(misses), ["take"]);

    misses.add("next");
    forgetChangedMainAudioMiss(misses, "song", "next");
    assert.deepEqual(Array.from(misses), ["take"]);
  });

  it("keeps misses while the main audio is unchanged or removed", () => {
    const misses = new Set(["song"]);
    forgetChangedMainAudioMiss(misses, "song", "song");
    forgetChangedMainAudioMiss(misses, "song", undefined);
    assert.deepEqual(Array.from(misses), ["song"]);
  });
});
