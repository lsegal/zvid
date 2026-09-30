import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaItem } from "../media.ts";
import { DEFAULT_LANES, INITIAL_PROJECT_STATE } from "./constants.ts";
import {
  buildStandaloneProject,
  mergeMediaItemsById,
  patchProjectState,
  pickMediaByPath,
} from "./session-project.ts";

const media = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: "a",
  name: "take.mp4",
  kind: "video",
  durationSeconds: 5,
  hasAudio: true,
  hasVideo: true,
  color: "#000",
  accent: "#fff",
  previewUrl: "",
  availability: "ready",
  ...extra,
});

describe("patchProjectState", () => {
  it("returns the same state when nothing changes", () => {
    assert.equal(
      patchProjectState(INITIAL_PROJECT_STATE, { bpm: 120 }),
      INITIAL_PROJECT_STATE,
    );
  });

  it("applies changed fields", () => {
    const next = patchProjectState(INITIAL_PROJECT_STATE, { bpm: 90 });
    assert.notEqual(next, INITIAL_PROJECT_STATE);
    assert.equal(next.bpm, 90);
  });
});

describe("mergeMediaItemsById", () => {
  it("replaces known items and ignores unknown ones", () => {
    const merged = mergeMediaItemsById(
      [media(), media({ id: "b" })],
      [media({ name: "new.mp4" }), media({ id: "c" })],
    );
    assert.deepEqual(
      merged.map((item) => [item.id, item.name]),
      [
        ["a", "new.mp4"],
        ["b", "take.mp4"],
      ],
    );
  });
});

describe("pickMediaByPath", () => {
  it("matches the source path first, then the file name", () => {
    const bySource = media({ id: "src", sourcePath: "C:\\clips\\take.mp4" });
    const byName = media({ id: "name" });
    assert.equal(
      pickMediaByPath([byName, bySource], "c:/clips/take.mp4")?.id,
      "src",
    );
    assert.equal(pickMediaByPath([byName], "/elsewhere/TAKE.mp4")?.id, "name");
    assert.equal(pickMediaByPath([byName], " "), undefined);
  });
});

describe("buildStandaloneProject", () => {
  it("lays imported media out across the default layers", () => {
    const project = buildStandaloneProject([
      media({ width: 640, height: 360 }),
      media({ id: "b", name: "b.mov" }),
    ]);
    assert.equal(project.lanes, DEFAULT_LANES);
    assert.equal(project.canvasWidth, 640);
    assert.equal(project.canvasHeight, 360);
    assert.deepEqual(
      project.arrangementClips.map((clip) => [clip.laneId, clip.startQ]),
      [
        [DEFAULT_LANES[0].id, 0],
        [DEFAULT_LANES[1].id, 4],
      ],
    );
    assert.equal(project.sourceTracks[1].name, "b");
  });
});
