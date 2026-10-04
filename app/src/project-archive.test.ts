import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  isProjectArchive,
  normalizeArchivePath,
  ProjectArchiveError,
  readProjectArchive,
  writeProjectArchive,
} from "./project-archive.ts";
import type { LvpSession } from "./session.ts";

const SESSION: LvpSession = {
  mainTracks: [{ id: "main-1", name: "Main" }],
  tracks: [{ id: "track-1", name: "Cam 1" }],
};

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// Builds a raw ustar entry so tests can craft archives the writer refuses
// to produce.
function tarEntry(name: string, content: string | Uint8Array, type = "0") {
  const data =
    typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.fill(0x20, 148, 156);
  header.write(type, 156);
  header.write("ustar\u000000", 257, "binary");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  return Buffer.concat([header, padded]);
}

function tarGz(...entries: Buffer[]) {
  return new Uint8Array(
    gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])),
  );
}

async function rejectsWith(promise: Promise<unknown>, message: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ProjectArchiveError);
    assert.match(error.message, message);
    return true;
  });
}

describe("project archive", () => {
  it("round-trips a project with no media", async () => {
    const blob = await writeProjectArchive({ project: SESSION, media: [] });
    const bytes = await bytesOf(blob);
    assert.deepEqual([...bytes.subarray(0, 2)], [0x1f, 0x8b]);

    const archive = await readProjectArchive(bytes);
    assert.deepEqual(archive.project, SESSION);
    assert.deepEqual(archive.media, []);
  });

  it("round-trips binary media and non-ASCII names", async () => {
    const binary = new Uint8Array(70_000);
    for (let i = 0; i < binary.length; i++) binary[i] = (i * 31 + 7) % 256;
    const longName = `media/${"clip-".repeat(30)}.mp4`;
    const media = [
      { path: "media/take 1.mov", blob: new Blob([binary]) },
      { path: "media/Café – 東京.wav", blob: new Blob(["ünïcødé audio"]) },
      { path: longName, blob: new Blob([]) },
      {
        path: "./media/sub/exact-512.bin",
        blob: new Blob([new Uint8Array(512).fill(9)]),
      },
    ];

    const blob = await writeProjectArchive({ project: SESSION, media });
    const archive = await readProjectArchive(blob);

    assert.deepEqual(archive.project, SESSION);
    assert.deepEqual(
      archive.media.map((m) => m.path),
      [
        "media/take 1.mov",
        "media/Café – 東京.wav",
        longName,
        "media/sub/exact-512.bin",
      ],
    );
    assert.deepEqual(await bytesOf(archive.media[0].file), binary);
    assert.equal(archive.media[0].file.name, "take 1.mov");
    assert.equal(await archive.media[1].file.text(), "ünïcødé audio");
    assert.equal(archive.media[1].file.name, "Café – 東京.wav");
    assert.equal(archive.media[2].file.size, 0);
    assert.deepEqual(
      await bytesOf(archive.media[3].file),
      new Uint8Array(512).fill(9),
    );
  });

  it("writes a standard tar with project.json first", async () => {
    const blob = await writeProjectArchive({
      project: SESSION,
      media: [{ path: "media/a.mp4", blob: new Blob(["video"]) }],
    });
    const tar = gunzipSync(await bytesOf(blob));
    assert.equal(tar.toString("utf8", 0, 12), "project.json");
    assert.equal(tar.toString("binary", 257, 263), "ustar\0");
    assert.equal(tar.length % 512, 0);
  });

  it("reads archives written by other tar tools", async () => {
    const bytes = tarGz(
      tarEntry("./", "", "5"),
      tarEntry("./media/", "", "5"),
      tarEntry("./media/a.mp4", "video"),
      tarEntry("./project.json", JSON.stringify(SESSION)),
      tarEntry("./notes.txt", "ignored"),
    );
    const archive = await readProjectArchive(bytes);
    assert.deepEqual(archive.project, SESSION);
    assert.deepEqual(
      archive.media.map((m) => m.path),
      ["media/a.mp4"],
    );
    assert.equal(await archive.media[0].file.text(), "video");
  });

  it("fails when project.json is missing", async () => {
    const bytes = tarGz(tarEntry("media/a.mp4", "video"));
    await rejectsWith(readProjectArchive(bytes), /missing project\.json/);
    assert.equal(await isProjectArchive(bytes), false);
  });

  it("fails when project.json is not a session object", async () => {
    await rejectsWith(
      readProjectArchive(tarGz(tarEntry("project.json", "{nope"))),
      /not valid JSON/,
    );
    await rejectsWith(
      readProjectArchive(tarGz(tarEntry("project.json", "[1]"))),
      /not a session object/,
    );
  });

  for (const path of [
    "../evil.txt",
    "media/../../evil.txt",
    "/etc/passwd",
    "C:/evil.txt",
    "media\\..\\evil.txt",
  ]) {
    it(`rejects the path-escaping entry ${JSON.stringify(path)}`, async () => {
      const bytes = tarGz(
        tarEntry("project.json", JSON.stringify(SESSION)),
        tarEntry(path, "x"),
      );
      await rejectsWith(readProjectArchive(bytes), /outside the archive root/);
    });
  }

  it("rejects links", async () => {
    const bytes = tarGz(
      tarEntry("project.json", JSON.stringify(SESSION)),
      tarEntry("media/link", "", "2"),
    );
    await rejectsWith(readProjectArchive(bytes), /not a regular file/);
  });

  it("refuses to write media outside media/", async () => {
    for (const path of [
      "project.json",
      "media/",
      "media/../x",
      "/media/a",
      "a.mp4",
    ]) {
      await rejectsWith(
        writeProjectArchive({
          project: SESSION,
          media: [{ path, blob: new Blob([]) }],
        }),
        /must be inside media\//,
      );
    }
    await rejectsWith(
      writeProjectArchive({
        project: SESSION,
        media: [
          { path: "media/a", blob: new Blob([]) },
          { path: "./media/a", blob: new Blob([]) },
        ],
      }),
      /Duplicate media path/,
    );
  });

  it("fails on non-gzip input", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(SESSION));
    await rejectsWith(readProjectArchive(bytes), /not gzip-compressed/);
    await rejectsWith(
      readProjectArchive(new Uint8Array()),
      /not gzip-compressed/,
    );
    assert.equal(await isProjectArchive(bytes), false);
  });

  it("fails on a corrupt or malformed archive", async () => {
    const good = await bytesOf(
      await writeProjectArchive({ project: SESSION, media: [] }),
    );
    await rejectsWith(
      readProjectArchive(good.subarray(0, 20)),
      /Malformed project archive/,
    );
    await rejectsWith(
      readProjectArchive(
        new Uint8Array(gzipSync(Buffer.from("not a tar".repeat(100)))),
      ),
      /Malformed project archive/,
    );
    const truncated = gunzipSync(good).subarray(0, 600);
    await rejectsWith(
      readProjectArchive(new Uint8Array(gzipSync(truncated))),
      /Malformed project archive/,
    );
  });

  it("tells a project archive from an Ableton Live set", async () => {
    const archive = await writeProjectArchive({
      project: SESSION,
      media: [{ path: "media/a.mp4", blob: new Blob(["video"]) }],
    });
    assert.equal(await isProjectArchive(archive), true);
    assert.equal(await isProjectArchive(await bytesOf(archive)), true);

    const liveSet = new Uint8Array(
      gzipSync(
        Buffer.from('<?xml version="1.0"?><Ableton MajorVersion="5" />'),
      ),
    );
    assert.equal(await isProjectArchive(liveSet), false);
  });

  it("normalizes archive paths", () => {
    assert.equal(normalizeArchivePath("./media//a.mp4"), "media/a.mp4");
    assert.equal(normalizeArchivePath("media/./a.mp4"), "media/a.mp4");
    assert.equal(normalizeArchivePath("./"), null);
    assert.equal(normalizeArchivePath("a/../b"), null);
  });
});
