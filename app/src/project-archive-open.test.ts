import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkspaceFileRef } from "./harness/contracts.ts";
import { ProjectArchiveError, writeProjectArchive } from "./project-archive.ts";
import {
  isProjectArchiveFilename,
  openProjectArchive,
} from "./project-archive-open.ts";
import type { LvpSession } from "./session.ts";

const SESSION = {
  mainTracks: [{ id: "1", name: "Layer 1" }],
  tracks: [],
  clips: [
    { id: "a", filePath: "media/take.mp4" },
    { id: "b", filePath: "media/other.mov" },
  ],
  audioFilename: "media/Song.wav",
} as unknown as LvpSession;

async function archiveBytes(
  project: LvpSession,
  media: Array<{ path: string; blob: Blob }> = [],
) {
  const blob = await writeProjectArchive({ project, media });
  return new Uint8Array(await blob.arrayBuffer());
}

async function textAt(url: string) {
  return (await fetch(url)).text();
}

describe("isProjectArchiveFilename", () => {
  it("matches .zvd in any case and nothing else", () => {
    assert.equal(isProjectArchiveFilename("Set.zvd"), true);
    assert.equal(isProjectArchiveFilename("set.ZVD "), true);
    assert.equal(isProjectArchiveFilename("set.lvp"), false);
    assert.equal(isProjectArchiveFilename("set.als"), false);
  });
});

describe("openProjectArchive", () => {
  it("resolves media/ paths to the archive's bundled files", async () => {
    const bytes = await archiveBytes(SESSION, [
      { path: "media/take.mp4", blob: new Blob(["take"]) },
      { path: "media/Song.wav", blob: new Blob(["song"]) },
    ]);

    const payload = await openProjectArchive(bytes, "Set.zvd");

    assert.deepEqual(payload.session, SESSION);
    assert.equal(payload.sessionName, "Set.zvd");
    assert.equal(payload.sessionPath, undefined);
    const byPath = new Map(payload.mediaRefs.map((ref) => [ref.path, ref]));
    assert.deepEqual(
      payload.mediaRefs.map((ref) => [ref.path, ref.name, ref.exists]),
      [
        ["media/take.mp4", "take.mp4", true],
        ["media/other.mov", "other.mov", false],
        ["media/Song.wav", "Song.wav", true],
      ],
    );
    assert.equal(await textAt(byPath.get("media/take.mp4")?.url ?? ""), "take");
    assert.equal(await textAt(byPath.get("media/Song.wav")?.url ?? ""), "song");
    assert.equal(byPath.get("media/other.mov")?.url, "");
  });

  it("opens an archive without media with every path offline", async () => {
    const payload = await openProjectArchive(
      await archiveBytes(SESSION),
      "Bare.zvd",
    );

    assert.equal(payload.mediaRefs.length, 3);
    assert.ok(payload.mediaRefs.every((ref) => !ref.exists && !ref.url));
  });

  it("resolves the rest from a workspace folder, preferring bundled files", async () => {
    const bytes = await archiveBytes(SESSION, [
      { path: "media/take.mp4", blob: new Blob(["bundled"]) },
    ]);
    const files: WorkspaceFileRef[] = [
      { path: "Set.zvd", file: new File([bytes], "Set.zvd") },
      { path: "media/take.mp4", file: new File(["beside"], "take.mp4") },
      { path: "media/other.mov", file: new File(["other"], "other.mov") },
    ];

    const payload = await openProjectArchive(bytes, "Set.zvd", {
      kind: "workspace",
      rootName: "Project",
      sessionPath: "Set.zvd",
      sessionFile: files[0].file,
      files,
    });

    assert.equal(payload.sessionName, "Set.zvd");
    assert.equal(payload.sessionPath, "Project/Set.zvd");
    const byPath = new Map(payload.mediaRefs.map((ref) => [ref.path, ref]));
    assert.equal(
      await textAt(byPath.get("media/take.mp4")?.url ?? ""),
      "bundled",
    );
    assert.equal(
      await textAt(byPath.get("media/other.mov")?.url ?? ""),
      "other",
    );
    assert.equal(byPath.get("media/Song.wav")?.exists, false);
  });

  it("rejects an old plain-JSON .zvd as not a project archive", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(SESSION));

    await assert.rejects(
      openProjectArchive(bytes, "Old.zvd"),
      (error: unknown) =>
        error instanceof ProjectArchiveError &&
        error.message === "Old.zvd is not a zvid project archive.",
    );
  });

  it("rejects gzip that is not an archive, like a renamed Live set", async () => {
    const { gzipSync } = await import("node:zlib");
    const bytes = new Uint8Array(gzipSync('<?xml version="1.0"?><Ableton/>'));

    await assert.rejects(
      openProjectArchive(bytes, "Live.zvd"),
      /^ProjectArchiveError: Live\.zvd is not a zvid project archive\.$/,
    );
  });
});
