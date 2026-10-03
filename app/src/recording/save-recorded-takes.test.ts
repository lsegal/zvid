import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaItem, Palette } from "../media.ts";
import type { PlacedTake } from "./recorded-takes.ts";
import type { FinishedTake } from "./recording-session.ts";
import {
  type RecordedPass,
  type SaveTakesDeps,
  saveRecordedTakes,
} from "./save-recorded-takes.ts";

const PALETTES: Palette[] = [{ color: "#111", accent: "#222" }];

const pass = (
  trackIds: string[],
  endedReasons: [string, string][] = [],
): RecordedPass => ({
  trackIds,
  startQ: 8,
  startedAt: new Date(2026, 9, 3, 12, 0, 0),
  endedReasons: new Map(endedReasons),
});

const take = (trackId: string, bytes = 4): FinishedTake => ({
  trackId,
  blob: new Blob([new Uint8Array(bytes)], { type: "video/webm" }),
  mimeType: "video/webm",
  hasVideo: true,
  hasAudio: true,
  durationSeconds: 3,
});

const analyzedItem = (file: File): MediaItem => ({
  id: `analyzed:${file.name}`,
  name: file.name,
  kind: "video",
  durationSeconds: 0,
  hasAudio: true,
  hasVideo: true,
  fileSizeBytes: file.size,
  container: "WebM",
  color: "#333",
  accent: "#444",
  previewUrl: "blob:analyzed",
  availability: "ready",
});

// A stub harness: tracks named after their IDs, analysis that works unless
// the file belongs to a track in `failAnalysis`, and placements recorded.
function stubDeps(
  options: {
    failAnalysis?: string[];
    tracks?: string[];
    place?: (takes: PlacedTake[]) => void;
  } = {},
) {
  const placed: PlacedTake[][] = [];
  const deps: SaveTakesDeps = {
    trackName: (trackId) => trackId,
    hasTrack: (trackId) => (options.tracks ?? ["cam", "mic"]).includes(trackId),
    remux: async (blob) => blob,
    analyze: async (file) => {
      if (options.failAnalysis?.some((id) => file.name.startsWith(id))) {
        throw new Error("analysis failed");
      }
      return analyzedItem(file);
    },
    createPreviewUrl: () => "blob:raw",
    palettes: PALETTES,
    place:
      options.place ??
      ((takes) => {
        placed.push(takes);
      }),
  };
  return { deps, placed };
}

describe("saveRecordedTakes", () => {
  it("places every take of a successful pass, analyzed, in one change", async () => {
    const { deps, placed } = stubDeps();
    const result = await saveRecordedTakes(
      pass(["cam", "mic"]),
      [take("cam"), take("mic")],
      deps,
    );

    assert.deepEqual(result.failures, []);
    assert.equal(result.unanalyzed, 0);
    assert.equal(placed.length, 1);
    assert.deepEqual(
      placed[0]?.map(({ trackId, startQ }) => [trackId, startQ]),
      [
        ["cam", 8],
        ["mic", 8],
      ],
    );
    // An analyzed take without a duration gets the recorded one.
    assert.deepEqual(
      result.items.map((item) => [item.id.split(":")[0], item.durationSeconds]),
      [
        ["analyzed", 3],
        ["analyzed", 3],
      ],
    );
  });

  it("keeps both takes when analyzing one of them fails", async () => {
    const { deps, placed } = stubDeps({ failAnalysis: ["mic"] });
    const result = await saveRecordedTakes(
      pass(["cam", "mic"]),
      [take("cam"), take("mic")],
      deps,
    );

    assert.deepEqual(result.failures, []);
    assert.equal(result.unanalyzed, 1);
    assert.deepEqual(
      placed[0]?.map(({ trackId }) => trackId),
      ["cam", "mic"],
    );
    const raw = result.items[1];
    assert.ok(raw);
    // The raw recording lasts as long as it recorded and has no file
    // details, so it's analyzed again later.
    assert.match(raw.name, /^mic .*\.webm$/);
    assert.equal(raw.durationSeconds, 3);
    assert.equal(raw.previewUrl, "blob:raw");
    assert.equal(raw.fileSizeBytes, undefined);
    assert.equal(raw.hasAudio, true);
    assert.equal(raw.hasVideo, true);
    assert.equal(raw.color, "#111");
  });

  it("keeps a take when its file can't be remuxed", async () => {
    const { deps, placed } = stubDeps();
    deps.remux = async () => {
      throw new Error("remux failed");
    };
    const result = await saveRecordedTakes(pass(["cam"]), [take("cam")], deps);

    assert.deepEqual(result.failures, []);
    assert.equal(placed[0]?.length, 1);
  });

  it("reports a track that captured nothing and keeps the others", async () => {
    const { deps, placed } = stubDeps();
    const result = await saveRecordedTakes(
      pass(["cam", "mic"]),
      [take("cam"), take("mic", 0)],
      deps,
    );

    assert.deepEqual(result.failures, [
      { trackId: "mic", message: "nothing was captured" },
    ]);
    assert.deepEqual(
      placed[0]?.map(({ trackId }) => trackId),
      ["cam"],
    );
  });

  it("reports why a track that stopped early captured nothing", async () => {
    const { deps, placed } = stubDeps();
    const result = await saveRecordedTakes(
      pass(["cam"], [["cam", "the camera was disconnected"]]),
      [],
      deps,
    );

    assert.deepEqual(result.failures, [
      { trackId: "cam", message: "the camera was disconnected" },
    ]);
    assert.deepEqual(result.items, []);
    assert.equal(placed.length, 0);
  });

  it("reports takes whose track was deleted while recording", async () => {
    const { deps, placed } = stubDeps({ tracks: ["cam"] });
    const result = await saveRecordedTakes(
      pass(["cam", "mic"]),
      [take("cam"), take("mic")],
      deps,
    );

    assert.deepEqual(result.failures, [
      { trackId: "mic", message: "its track was deleted while recording" },
    ]);
    assert.deepEqual(
      placed[0]?.map(({ trackId }) => trackId),
      ["cam"],
    );
  });

  it("reports every take when placing them fails", async () => {
    const { deps } = stubDeps({
      place: () => {
        throw new Error("commit failed");
      },
    });
    const result = await saveRecordedTakes(
      pass(["cam", "mic"]),
      [take("cam"), take("mic")],
      deps,
    );

    assert.deepEqual(result.items, []);
    assert.deepEqual(result.failures, [
      { trackId: "cam", message: "commit failed" },
      { trackId: "mic", message: "commit failed" },
    ]);
  });
});
