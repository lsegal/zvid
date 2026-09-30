import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { downloadKey, handleDownload } from "../worker/downloads.ts";

const INSTALLER = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const KEY = "downloads/zvid-capture-0.1.0-28ff96d.pkg";

type GetOptions = { range?: Headers; onlyIf?: Headers };

// A one-object stand-in for the R2 binding, honouring `Range` and
// `If-None-Match` the way R2's get does.
function bucket(objects: Record<string, Uint8Array>) {
  const describe = (key: string, range?: R2Range) =>
    ({
      key,
      size: objects[key].byteLength,
      httpEtag: '"etag-1"',
      range,
      writeHttpMetadata(headers: Headers) {
        headers.set("Content-Type", "application/octet-stream");
      },
    }) as unknown as R2Object;
  return {
    async head(key: string) {
      return key in objects ? describe(key) : null;
    },
    async get(key: string, options: GetOptions = {}) {
      if (!(key in objects)) {
        return null;
      }
      if (options.onlyIf?.get("If-None-Match") === '"etag-1"') {
        return describe(key);
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(
        options.range?.get("Range") ?? "",
      );
      const range = match
        ? { offset: Number(match[1]), length: Number(match[2]) - Number(match[1]) + 1 }
        : undefined;
      const bytes = range
        ? objects[key].slice(range.offset, range.offset + range.length)
        : objects[key];
      return { ...describe(key, range), body: new Blob([bytes]).stream() };
    },
  } as unknown as R2Bucket;
}

const ENV = { CAPTURE_INSTALLERS: bucket({ [KEY]: INSTALLER }) };

function request(path: string, init?: RequestInit) {
  return new Request(`https://zvid.example${path}`, init);
}

describe("downloadKey", () => {
  it("maps installer paths to their R2 key", () => {
    assert.equal(downloadKey("/downloads/zvid-capture-0.1.0-28ff96d.pkg"), KEY);
    assert.equal(
      downloadKey("/downloads/zvid-capture%200.1.0-setup.exe"),
      "downloads/zvid-capture 0.1.0-setup.exe",
    );
  });

  it("leaves the manifest and other paths to the static assets", () => {
    assert.equal(downloadKey("/downloads/zvid-capture.json"), null);
    assert.equal(downloadKey("/downloads/"), null);
    assert.equal(downloadKey("/downloads/a/b.pkg"), null);
    assert.equal(downloadKey("/downloads/%2e%2e%2fsecret"), null);
    assert.equal(downloadKey("/downloads/%E0%A4%A"), null);
    assert.equal(downloadKey("/index.html"), null);
  });
});

describe("handleDownload", () => {
  it("streams the installer from R2 as an attachment", async () => {
    const response = await handleDownload(request("/"), ENV, KEY);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Length"), "8");
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(
      response.headers.get("Content-Disposition"),
      'attachment; filename="zvid-capture-0.1.0-28ff96d.pkg"',
    );
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), INSTALLER);
  });

  it("answers HEAD with the size and no body", async () => {
    const response = await handleDownload(
      request("/", { method: "HEAD" }),
      ENV,
      KEY,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Length"), "8");
    assert.equal(response.body, null);
  });

  it("serves byte ranges for resumed downloads", async () => {
    const response = await handleDownload(
      request("/", { headers: { Range: "bytes=2-4" } }),
      ENV,
      KEY,
    );
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 2-4/8");
    assert.equal(response.headers.get("Content-Length"), "3");
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      INSTALLER.slice(2, 5),
    );
  });

  it("answers a matching If-None-Match with 304", async () => {
    const response = await handleDownload(
      request("/", { headers: { "If-None-Match": '"etag-1"' } }),
      ENV,
      KEY,
    );
    assert.equal(response.status, 304);
  });

  it("returns 404 for installers the bucket lacks", async () => {
    const response = await handleDownload(
      request("/"),
      ENV,
      "downloads/missing.pkg",
    );
    assert.equal(response.status, 404);
  });

  it("rejects other methods", async () => {
    const response = await handleDownload(
      request("/", { method: "POST" }),
      ENV,
      KEY,
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
  });
});
