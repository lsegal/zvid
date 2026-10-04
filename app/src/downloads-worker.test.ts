import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DOWNLOADS_PATH_PREFIX,
  type DownloadObject,
  type DownloadRange,
  type DownloadsBucket,
  downloadKey,
  handleDownload,
  parseRange,
} from "../worker/downloads.ts";

const INSTALLER = "capture/zvid-capture-macos.pkg";
const CONTENTS = new TextEncoder().encode("0123456789");

type StoredObject = { contents: Uint8Array; etag: string };

// An in-memory stand-in for the R2 binding, storing objects with the HTTP
// metadata the DAW bundles workflow uploads installers with.
function bucket(objects: Record<string, StoredObject>) {
  const gets: { key: string; range?: DownloadRange }[] = [];
  const describe = (stored: StoredObject): DownloadObject => ({
    size: stored.contents.byteLength,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    writeHttpMetadata(headers) {
      headers.set("Content-Type", "application/octet-stream");
      headers.set(
        "Content-Disposition",
        'attachment; filename="zvid-capture-macos.pkg"',
      );
      headers.set("Cache-Control", "no-cache");
    },
  });
  const binding: DownloadsBucket = {
    async head(key) {
      return key in objects ? describe(objects[key]) : null;
    },
    async get(key, options) {
      gets.push({ key, range: options?.range });
      const stored = objects[key];
      if (!stored) {
        return null;
      }
      if (options?.onlyIf && options.onlyIf.etagMatches !== stored.etag) {
        return describe(stored);
      }
      const { offset = 0, length = stored.contents.byteLength } =
        options?.range ?? {};
      const bytes = stored.contents.slice(offset, offset + length);
      return {
        ...describe(stored),
        body: new Response(bytes).body,
      };
    },
  };
  return { binding, gets };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://zvid.example${path}`, init);
}

function env() {
  return bucket({ [INSTALLER]: { contents: CONTENTS, etag: "abc123" } });
}

describe("wrangler.jsonc", () => {
  // Static assets use SPA not-found handling, which answers navigations with
  // index.html before the Worker runs unless the path is listed here.
  it("runs the Worker first for downloads and the API", () => {
    const source = readFileSync(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
    assert.equal(config.assets.not_found_handling, "single-page-application");
    assert.deepEqual(config.assets.run_worker_first, [
      `${DOWNLOADS_PATH_PREFIX}*`,
      "/api/*",
    ]);
  });
});

describe("downloadKey", () => {
  it("maps /downloads paths to bucket keys", () => {
    assert.equal(downloadKey(`/downloads/${INSTALLER}`), INSTALLER);
    assert.equal(
      downloadKey("/downloads/capture/a%20b.exe"),
      "capture/a b.exe",
    );
  });

  it("rejects paths that name no object", () => {
    assert.equal(downloadKey("/downloads/"), null);
    assert.equal(downloadKey("/downloads/capture/"), null);
    assert.equal(downloadKey("/downloads/capture/%2E%2E/secret"), null);
    assert.equal(downloadKey("/downloads/%E0%A4%A"), null);
  });
});

describe("parseRange", () => {
  it("parses a single byte range", () => {
    assert.deepEqual(parseRange("bytes=2-5", 10), { offset: 2, length: 4 });
    assert.deepEqual(parseRange("bytes=4-", 10), { offset: 4, length: 6 });
    assert.deepEqual(parseRange("bytes=8-99", 10), { offset: 8, length: 2 });
    assert.deepEqual(parseRange("bytes=-3", 10), { offset: 7, length: 3 });
    assert.deepEqual(parseRange("bytes=-30", 10), { offset: 0, length: 10 });
  });

  it("ignores missing, malformed and multiple ranges", () => {
    assert.equal(parseRange(null, 10), null);
    assert.equal(parseRange("bytes=-", 10), null);
    assert.equal(parseRange("bytes=5-2", 10), null);
    assert.equal(parseRange("items=0-1", 10), null);
    assert.equal(parseRange("bytes=0-1,4-5", 10), null);
  });

  it("flags ranges past the end", () => {
    assert.equal(parseRange("bytes=10-", 10), "unsatisfiable");
    assert.equal(parseRange("bytes=-0", 10), "unsatisfiable");
    assert.equal(parseRange("bytes=0-", 0), "unsatisfiable");
  });
});

describe("handleDownload", () => {
  it("streams an object with its stored headers", async () => {
    const { binding } = env();
    const response = await handleDownload(request(`/downloads/${INSTALLER}`), {
      DOWNLOADS: binding,
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "0123456789");
    assert.equal(response.headers.get("ETag"), '"abc123"');
    assert.equal(response.headers.get("Content-Length"), "10");
    assert.equal(response.headers.get("Accept-Ranges"), "bytes");
    assert.equal(response.headers.get("Cache-Control"), "no-cache");
    assert.equal(
      response.headers.get("Content-Disposition"),
      'attachment; filename="zvid-capture-macos.pkg"',
    );
  });

  it("answers HEAD without reading the object", async () => {
    const { binding, gets } = env();
    const response = await handleDownload(
      request(`/downloads/${INSTALLER}`, { method: "HEAD" }),
      { DOWNLOADS: binding },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("Content-Length"), "10");
    assert.equal(response.headers.get("ETag"), '"abc123"');
    assert.deepEqual(gets, []);
  });

  it("serves byte ranges", async () => {
    const { binding, gets } = env();
    const response = await handleDownload(
      request(`/downloads/${INSTALLER}`, { headers: { Range: "bytes=2-5" } }),
      { DOWNLOADS: binding },
    );
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "2345");
    assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10");
    assert.equal(response.headers.get("Content-Length"), "4");
    assert.deepEqual(gets, [
      { key: INSTALLER, range: { offset: 2, length: 4 } },
    ]);

    const head = await handleDownload(
      request(`/downloads/${INSTALLER}`, {
        method: "HEAD",
        headers: { Range: "bytes=-3" },
      }),
      { DOWNLOADS: binding },
    );
    assert.equal(head.status, 206);
    assert.equal(head.headers.get("Content-Range"), "bytes 7-9/10");
  });

  it("rejects ranges past the end", async () => {
    const { binding } = env();
    const response = await handleDownload(
      request(`/downloads/${INSTALLER}`, { headers: { Range: "bytes=10-" } }),
      { DOWNLOADS: binding },
    );
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */10");
  });

  it("serves the whole object when If-Range names an older one", async () => {
    const { binding } = env();
    const response = await handleDownload(
      request(`/downloads/${INSTALLER}`, {
        headers: { Range: "bytes=2-5", "If-Range": '"old"' },
      }),
      { DOWNLOADS: binding },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "0123456789");

    const resumed = await handleDownload(
      request(`/downloads/${INSTALLER}`, {
        headers: { Range: "bytes=2-5", "If-Range": '"abc123"' },
      }),
      { DOWNLOADS: binding },
    );
    assert.equal(resumed.status, 206);
  });

  it("answers a matching If-None-Match with 304", async () => {
    const { binding, gets } = env();
    const response = await handleDownload(
      request(`/downloads/${INSTALLER}`, {
        headers: { "If-None-Match": 'W/"abc123"' },
      }),
      { DOWNLOADS: binding },
    );
    assert.equal(response.status, 304);
    assert.deepEqual(gets, []);
  });

  it("returns 404 for missing objects and a missing binding", async () => {
    const { binding } = env();
    const missing = await handleDownload(
      request("/downloads/capture/manifest.json"),
      { DOWNLOADS: binding },
    );
    assert.equal(missing.status, 404);
    const unbound = await handleDownload(
      request(`/downloads/${INSTALLER}`),
      {},
    );
    assert.equal(unbound.status, 404);
    const folder = await handleDownload(request("/downloads/capture/"), {
      DOWNLOADS: binding,
    });
    assert.equal(folder.status, 404);
  });

  it("only allows GET and HEAD", async () => {
    const { binding } = env();
    const response = await handleDownload(
      request(`/downloads/${INSTALLER}`, { method: "PUT", body: "x" }),
      { DOWNLOADS: binding },
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
  });

  it("asks the client to retry when the object is overwritten mid-request", async () => {
    const { binding } = env();
    const racing: DownloadsBucket = {
      head: binding.head,
      async get(key, options) {
        return binding.get(key, {
          ...options,
          onlyIf: { etagMatches: "newer" },
        });
      },
    };
    const response = await handleDownload(request(`/downloads/${INSTALLER}`), {
      DOWNLOADS: racing,
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "1");
  });
});
