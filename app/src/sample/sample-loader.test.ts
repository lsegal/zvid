import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildSampleOpenPayload,
  downloadSampleAsset,
  loadSampleAssets,
  SampleLoadCancelledError,
  type SampleLoadDeps,
  type SampleLoadProgress,
  sha256Hex,
  shouldAutoOpenSample,
} from "./sample-loader.ts";
import {
  findSampleAsset,
  resolveSampleMediaRefs,
  type SampleAsset,
  type SampleManifest,
} from "./sample-manifest.ts";

function asset(key: string, text: string): SampleAsset {
  const bytes = Buffer.from(text);
  return {
    id: `zvid-sample:test:${key}`,
    path: `zvid-sample://test/${key}.mp4`,
    url: `/samples/test/${key}.mp4`,
    name: `${key}.mp4`,
    mediaType: "video/mp4",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    credit: "test",
  };
}

const MANIFEST: SampleManifest = {
  id: "test",
  version: "test",
  sessionName: "Test sample",
  creditsUrl: "/samples/test/CREDITS.md",
  assets: [asset("one", "first asset"), asset("two", "the second asset")],
};

// A server with the manifest's bytes at their URLs, and a media cache.
function harness(
  options: { bodies?: Record<string, string>; failing?: Set<string> } = {},
) {
  const bodies: Record<string, string> = options.bodies ?? {
    "/samples/test/one.mp4": "first asset",
    "/samples/test/two.mp4": "the second asset",
  };
  const cache = new Map<string, Blob>();
  const fetched: string[] = [];
  const deps: SampleLoadDeps = {
    async fetch(url, init) {
      fetched.push(url);
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      if (options.failing?.has(url)) {
        throw new TypeError("Failed to fetch");
      }
      const body = bodies[url];
      return body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body);
    },
    getCached: async (id) => cache.get(id),
    cache: async (id, blob) => {
      cache.set(id, blob);
    },
    digest: sha256Hex,
  };
  return { deps, cache, fetched };
}

describe("loadSampleAssets", () => {
  it("downloads and caches every asset, reporting progress", async () => {
    const { deps, cache, fetched } = harness();
    const progress: SampleLoadProgress[] = [];
    const result = await loadSampleAssets(MANIFEST, deps, {
      onProgress: (update) => progress.push(update),
    });
    assert.equal(result.downloaded, 2);
    assert.deepEqual(fetched, [
      "/samples/test/one.mp4",
      "/samples/test/two.mp4",
    ]);
    assert.equal(
      await cache.get("zvid-sample:test:one")?.text(),
      "first asset",
    );
    assert.equal(
      await cache.get("zvid-sample:test:two")?.text(),
      "the second asset",
    );
    const total = MANIFEST.assets[0].bytes + MANIFEST.assets[1].bytes;
    assert.deepEqual(progress.at(-1), {
      loadedBytes: total,
      totalBytes: total,
      completedAssets: 2,
      totalAssets: 2,
      current: undefined,
    });
    assert.ok(progress.some((update) => update.current === "two.mp4"));
  });

  it("reuses cached assets without the network, so a warm cache opens offline", async () => {
    const { deps, cache } = harness();
    await loadSampleAssets(MANIFEST, deps);
    const offline = harness({
      failing: new Set(["/samples/test/one.mp4", "/samples/test/two.mp4"]),
    });
    for (const [id, blob] of cache) {
      await offline.deps.cache(id, blob);
    }
    const result = await loadSampleAssets(MANIFEST, offline.deps);
    assert.equal(result.downloaded, 0);
    assert.deepEqual(offline.fetched, []);
  });

  it("downloads an asset again when its cached copy was evicted or is truncated", async () => {
    const { deps, cache, fetched } = harness();
    await deps.cache("zvid-sample:test:one", new Blob(["first"]));
    await loadSampleAssets(MANIFEST, deps);
    assert.deepEqual(fetched, [
      "/samples/test/one.mp4",
      "/samples/test/two.mp4",
    ]);
    assert.equal(
      await cache.get("zvid-sample:test:one")?.text(),
      "first asset",
    );
  });

  it("fails on a cold cache offline, and a retry only downloads what is missing", async () => {
    const flaky = harness({ failing: new Set(["/samples/test/two.mp4"]) });
    await assert.rejects(
      loadSampleAssets(MANIFEST, flaky.deps),
      /Could not download two\.mp4: Failed to fetch/,
    );
    assert.ok(flaky.cache.has("zvid-sample:test:one"));

    const retry = harness();
    for (const [id, blob] of flaky.cache) {
      await retry.deps.cache(id, blob);
    }
    await loadSampleAssets(MANIFEST, retry.deps);
    assert.deepEqual(retry.fetched, ["/samples/test/two.mp4"]);
  });

  it("rejects bytes that don't match the manifest and caches nothing for them", async () => {
    const { deps, cache } = harness({
      bodies: {
        "/samples/test/one.mp4": "first assex",
        "/samples/test/two.mp4": "the second asset",
      },
    });
    await assert.rejects(
      loadSampleAssets(MANIFEST, deps),
      /one\.mp4 did not match the sample manifest/,
    );
    assert.equal(cache.size, 0);
  });

  it("reports a failed response", async () => {
    const { deps } = harness({ bodies: {} });
    await assert.rejects(
      loadSampleAssets(MANIFEST, deps),
      /Could not download one\.mp4: 404/,
    );
  });

  it("stops when cancelled, without caching the asset in flight", async () => {
    const controller = new AbortController();
    const { deps, cache } = harness();
    const cancelling: SampleLoadDeps = {
      ...deps,
      async fetch(url, init) {
        controller.abort();
        return deps.fetch(url, init);
      },
    };
    await assert.rejects(
      loadSampleAssets(MANIFEST, cancelling, { signal: controller.signal }),
      SampleLoadCancelledError,
    );
    assert.equal(cache.size, 0);
  });
});

describe("downloadSampleAsset", () => {
  it("returns the checked bytes with the asset's media type", async () => {
    const { deps } = harness();
    const blob = await downloadSampleAsset(MANIFEST.assets[1], deps);
    assert.equal(blob.type, "video/mp4");
    assert.equal(await blob.text(), "the second asset");
  });
});

describe("sample media refs", () => {
  it("open the sample with every asset missing under its stable id", () => {
    const payload = buildSampleOpenPayload(MANIFEST, '{"mainTracks":[]}');
    assert.equal(payload.sessionName, "Test sample");
    assert.deepEqual(payload.session, { mainTracks: [] });
    assert.deepEqual(
      payload.mediaRefs.map(({ id, exists, url }) => ({ id, exists, url })),
      [
        { id: "zvid-sample:test:one", exists: false, url: "" },
        { id: "zvid-sample:test:two", exists: false, url: "" },
      ],
    );
  });

  it("keep their stable ids when a saved copy is reopened through a harness", () => {
    const refs = resolveSampleMediaRefs(
      [
        {
          id: "3f2a-one.mp4",
          path: "zvid-sample://test/one.mp4",
          name: "one.mp4",
          url: "",
          exists: false,
        },
        {
          id: "c0ffee-clip.mp4",
          path: "C:/media/clip.mp4",
          name: "clip.mp4",
          url: "/media/clip.mp4",
          exists: true,
        },
      ],
      [MANIFEST],
    );
    assert.equal(refs[0].id, "zvid-sample:test:one");
    assert.equal(refs[0].exists, false);
    assert.equal(refs[1].id, "c0ffee-clip.mp4");
    assert.equal(refs[1].exists, true);
  });

  it("find their asset by path only", () => {
    assert.equal(
      findSampleAsset(MANIFEST, "zvid-sample://test/two.mp4")?.id,
      "zvid-sample:test:two",
    );
    assert.equal(findSampleAsset(MANIFEST, "/samples/test/two.mp4"), undefined);
    assert.equal(findSampleAsset(MANIFEST, undefined), undefined);
  });
});

describe("shouldAutoOpenSample", () => {
  const base = {
    access: "owner",
    restored: false,
    corrupt: false,
    search: "",
    webdriver: false,
  };

  it("opens the sample for an empty workspace", () => {
    assert.equal(shouldAutoOpenSample(base), true);
  });

  it("never replaces restored or unreadable work, or another tab's session", () => {
    assert.equal(shouldAutoOpenSample({ ...base, restored: true }), false);
    assert.equal(shouldAutoOpenSample({ ...base, corrupt: true }), false);
    assert.equal(shouldAutoOpenSample({ ...base, access: "blocked" }), false);
    assert.equal(shouldAutoOpenSample({ ...base, access: "joiner" }), false);
  });

  it("is off under automation unless asked for, and off when turned off", () => {
    assert.equal(shouldAutoOpenSample({ ...base, webdriver: true }), false);
    assert.equal(
      shouldAutoOpenSample({ ...base, webdriver: true, search: "?sample=1" }),
      true,
    );
    assert.equal(shouldAutoOpenSample({ ...base, search: "?sample=0" }), false);
  });
});
