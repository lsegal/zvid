import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  getSourceTrackDragState,
  getSourceTrackDropTarget,
  isMediaFile,
} from "./app/util.ts";

const sourceTrackRowTsx = readFileSync(
  new URL("./components/timeline/SourceTrackRow.tsx", import.meta.url),
  "utf8",
);
const sourceTracksTsx = readFileSync(
  new URL("./components/timeline/SourceTracks.tsx", import.meta.url),
  "utf8",
);

const file = (name: string, type = "") => ({ name, type });
const item = (type: string, kind = "file") => ({ kind, type });

// A stand-in element that is or sits inside an element with these attributes.
const within = (attributes: Record<string, string> | null) =>
  ({
    closest: (selector: string) =>
      attributes && selector === "[data-source-track-drop-target]"
        ? {
            getAttribute: (name: string) => attributes[name] ?? null,
            hasAttribute: (name: string) => name in attributes,
          }
        : null,
  }) as unknown as EventTarget;

describe("isMediaFile", () => {
  it("accepts audio and video by MIME type or extension", () => {
    assert.equal(isMediaFile(file("take", "video/mp4")), true);
    assert.equal(isMediaFile(file("mix", "audio/wav")), true);
    assert.equal(isMediaFile(file("Take.MOV")), true);
    assert.equal(isMediaFile(file("mix.flac")), true);
  });

  it("rejects images and text", () => {
    assert.equal(isMediaFile(file("still.png", "image/png")), false);
    assert.equal(isMediaFile(file("notes.txt", "text/plain")), false);
  });
});

describe("getSourceTrackDragState", () => {
  it("accepts audio and video file items during dragover", () => {
    assert.deepEqual(
      getSourceTrackDragState({
        types: ["Files"],
        files: [],
        items: [item("video/mp4"), item("audio/mpeg")],
      }),
      { kind: "accept", fileCount: 2 },
    );
  });

  it("accepts file items whose type the OS does not know", () => {
    assert.deepEqual(
      getSourceTrackDragState({
        types: ["Files"],
        files: [],
        items: [item("")],
      }),
      { kind: "accept", fileCount: 1 },
    );
  });

  it("counts only the media among mixed file items", () => {
    assert.deepEqual(
      getSourceTrackDragState({
        types: ["Files"],
        items: [item("image/png"), item("audio/wav")],
      }),
      { kind: "accept", fileCount: 1 },
    );
  });

  it("rejects drags of only non-media files", () => {
    assert.deepEqual(
      getSourceTrackDragState({
        types: ["Files"],
        items: [item("image/png"), item("text/plain")],
      }),
      { kind: "reject" },
    );
    assert.deepEqual(
      getSourceTrackDragState({
        types: ["Files"],
        files: [file("still.png", "image/png")],
      }),
      { kind: "reject" },
    );
  });

  it("uses exposed files when available", () => {
    assert.deepEqual(
      getSourceTrackDragState({
        types: ["Files"],
        files: [file("take.mov"), file("notes.txt", "text/plain")],
      }),
      { kind: "accept", fileCount: 1 },
    );
  });

  it("accepts a file drag with no item details", () => {
    assert.deepEqual(
      getSourceTrackDragState({ types: ["Files"], files: [], items: [] }),
      { kind: "accept", fileCount: 0 },
    );
  });

  it("ignores drags that carry no files", () => {
    assert.deepEqual(
      getSourceTrackDragState({
        types: ["text/plain"],
        items: [item("text/plain", "string")],
      }),
      { kind: "none" },
    );
    assert.deepEqual(getSourceTrackDragState(null), { kind: "none" });
  });
});

describe("getSourceTrackDropTarget", () => {
  it("resolves a track row to that track", () => {
    assert.deepEqual(
      getSourceTrackDropTarget(
        within({
          "data-source-track-drop-target": "track",
          "data-source-track-id": "source-track-1",
        }),
      ),
      { kind: "track", trackId: "source-track-1" },
    );
  });

  it("resolves the new-track row and header to a new track", () => {
    assert.deepEqual(
      getSourceTrackDropTarget(
        within({ "data-source-track-drop-target": "new-track" }),
      ),
      { kind: "new-track" },
    );
  });

  it("carries the drop position from the track and new-track rows", () => {
    assert.deepEqual(
      getSourceTrackDropTarget(
        within({
          "data-source-track-drop-target": "track",
          "data-source-track-id": "source-track-1",
          "data-source-track-drop-at-pointer": "",
        }),
        6,
      ),
      { kind: "track", trackId: "source-track-1", startQ: 6 },
    );
    assert.deepEqual(
      getSourceTrackDropTarget(
        within({
          "data-source-track-drop-target": "new-track",
          "data-source-track-drop-at-pointer": "",
        }),
        0,
      ),
      { kind: "new-track", startQ: 0 },
    );
  });

  it("drops no position on the header", () => {
    assert.deepEqual(
      getSourceTrackDropTarget(
        within({ "data-source-track-drop-target": "new-track" }),
        6,
      ),
      { kind: "new-track" },
    );
  });

  it("never falls back to a new track outside a drop target", () => {
    assert.equal(getSourceTrackDropTarget(within(null)), null);
    assert.equal(
      getSourceTrackDropTarget(
        within({ "data-source-track-drop-target": "track" }),
      ),
      null,
    );
    assert.equal(getSourceTrackDropTarget(null), null);
    assert.equal(getSourceTrackDropTarget({} as EventTarget), null);
  });
});

describe("source track drop wiring", () => {
  it("makes the whole track row, label included, its drop target", () => {
    const row = sourceTrackRowTsx.slice(
      sourceTrackRowTsx.indexOf("track-row track-row--source"),
      sourceTrackRowTsx.indexOf("<button"),
    );
    assert.match(row, /data-source-track-drop-target="track"/);
    assert.match(row, /data-source-track-id=\{track\.id\}/);
    assert.match(row, /data-source-track-drop-at-pointer/);
  });

  it("makes the whole new-track row its drop target", () => {
    const start = sourceTracksTsx.indexOf("track-row--source-drop");
    const row = sourceTracksTsx.slice(
      start,
      sourceTracksTsx.indexOf("<div", start),
    );
    assert.match(row, /data-source-track-drop-target="new-track"/);
    assert.match(row, /data-source-track-drop-at-pointer/);
  });
});
