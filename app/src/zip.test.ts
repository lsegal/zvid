import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { listZipEntries, readZipEntry, ZipError } from "./zip.ts";

type TestEntry = { name: string; data: Uint8Array; deflate?: boolean };

// Writes a zip the way `zip`/`ditto` do: local headers, then the central
// directory, then the end record. `localExtra` pads the local headers only,
// as some writers do, to check the data offset comes from the local header.
function makeZip(entries: TestEntry[], { localExtra = 0, comment = "" } = {}) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const body = entry.deflate
      ? new Uint8Array(deflateRawSync(entry.data))
      : entry.data;
    const method = entry.deflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length + localExtra + body.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, localExtra, true);
    local.set(name, 30);
    local.set(body, 30 + name.length + localExtra);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const commentBytes = encoder.encode(comment);
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22 + commentBytes.length);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, commentBytes.length, true);
  end.set(commentBytes, 22);

  const parts = [...locals, ...centrals, end];
  const zip = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    zip.set(part, position);
    position += part.length;
  }
  return zip;
}

const text = (value: string) => new TextEncoder().encode(value);

describe("listZipEntries", () => {
  it("lists every entry with its sizes", () => {
    const zip = makeZip([
      { name: "dir/", data: new Uint8Array() },
      { name: "dir/a.txt", data: text("hello") },
      { name: "b.bin", data: text("x".repeat(1000)), deflate: true },
    ]);
    const entries = listZipEntries(zip);
    assert.deepEqual(
      entries.map(({ name, method, size }) => ({ name, method, size })),
      [
        { name: "dir/", method: 0, size: 0 },
        { name: "dir/a.txt", method: 0, size: 5 },
        { name: "b.bin", method: 8, size: 1000 },
      ],
    );
    assert.ok(entries[2].compressedSize < 1000);
  });

  it("finds the end record behind an archive comment", () => {
    const zip = makeZip([{ name: "a", data: text("a") }], {
      comment: "made by a test",
    });
    assert.deepEqual(
      listZipEntries(zip).map((entry) => entry.name),
      ["a"],
    );
  });

  it("rejects bytes that are not a zip", () => {
    assert.throws(() => listZipEntries(text("<!doctype html>")), ZipError);
  });
});

describe("readZipEntry", () => {
  it("reads stored and deflated entries", async () => {
    const zip = makeZip([
      { name: "stored.txt", data: text("stored contents") },
      {
        name: "deflated.txt",
        data: text("deflated ".repeat(50)),
        deflate: true,
      },
    ]);
    const [stored, deflated] = listZipEntries(zip);
    assert.equal(
      new TextDecoder().decode(await readZipEntry(zip, stored)),
      "stored contents",
    );
    assert.equal(
      new TextDecoder().decode(await readZipEntry(zip, deflated)),
      "deflated ".repeat(50),
    );
  });

  it("reads nested zips, as GitHub artifacts wrap bundle zips", async () => {
    const inner = makeZip([
      { name: "bundle/", data: new Uint8Array() },
      { name: "bundle/setup.exe", data: text("installer"), deflate: true },
    ]);
    const outer = makeZip([{ name: "bundle.zip", data: inner, deflate: true }]);
    const innerBytes = await readZipEntry(outer, listZipEntries(outer)[0]);
    const setup = listZipEntries(innerBytes)[1];
    assert.equal(
      new TextDecoder().decode(await readZipEntry(innerBytes, setup)),
      "installer",
    );
  });

  it("locates data from the local header's own extra field", async () => {
    const zip = makeZip([{ name: "a.txt", data: text("abc") }], {
      localExtra: 12,
    });
    assert.equal(
      new TextDecoder().decode(await readZipEntry(zip, listZipEntries(zip)[0])),
      "abc",
    );
  });

  it("rejects unsupported compression methods", async () => {
    const zip = makeZip([{ name: "a.txt", data: text("abc") }]);
    const [entry] = listZipEntries(zip);
    await assert.rejects(readZipEntry(zip, { ...entry, method: 12 }), ZipError);
  });
});
