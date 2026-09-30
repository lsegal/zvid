import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildSampleOpenPayload,
  downloadSampleAsset,
  loadSampleAssets,
  SampleLoadCancelledError,
  type SampleAssetEvent,
  type SampleLoadDeps,
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

// The events `onAsset` reported, as `name:phase` (with bytes while
// receiving).
function recordEvents() {
  const events: string[] = [];
  const onAsset = (event: SampleAssetEvent) => {
    events.push(
      event.phase === "receiving"
        ? `${event.asset.name}:receiving:${event.received}/${event.total}`
        : `${event.asset.name}:${event.phase}`,
    );
  };
  return { events, onAsset };
}

describe("loadSampleAssets", () => {
  it("downloads and caches every asset, reporting each one's progress", async () => {
    const { deps, cache, fetched } = harness();
    const { events, onAsset } = recordEvents();
    const result = await loadSampleAssets(MANIFEST.assets, deps, {
      concurrency: 1,
      onAsset,
    });
    assert.equal(result.downloaded, 2);
    assert.deepEqual(result.failed, []);
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
    const [one, two] = MANIFEST.assets;
    assert.deepEqual(events, [
      "one.mp4:queued",
      "two.mp4:queued",
      `one.mp4:receiving:0/${one.bytes}`,
      `one.mp4:receiving:${one.bytes}/${one.bytes}`,
      "one.mp4:ready",
      `two.mp4:receiving:0/${two.bytes}`,
      `two.mp4:receiving:${two.bytes}/${two.bytes}`,
      "two.mp4:ready",
    ]);
  });

  it("downloads at most `concurrency` assets at once", async () => {
    const { deps } = harness();
    let active = 0;
    let peak = 0;
    const slow: SampleLoadDeps = {
      ...deps,
      async fetch(url, init) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return deps.fetch(url, init);
      },
    };
    const assets = [...MANIFEST.assets, ...MANIFEST.assets, MANIFEST.assets[0]];
    await loadSampleAssets(assets, slow, { concurrency: 2 });
    assert.equal(peak, 2);
  });

  it("makes cached assets ready without the network, so a warm cache opens offline", async () => {
    const { deps, cache } = harness();
    await loadSampleAssets(MANIFEST.assets, deps);
    const offline = harness({
      failing: new Set(["/samples/test/one.mp4", "/samples/test/two.mp4"]),
    });
    for (const [id, blob] of cache) {
      await offline.deps.cache(id, blob);
    }
    const { events, onAsset } = recordEvents();
    const result = await loadSampleAssets(MANIFEST.assets, offline.deps, {
      onAsset,
    });
    assert.equal(result.downloaded, 0);
    assert.deepEqual(offline.fetched, []);
    assert.deepEqual(events, ["one.mp4:ready", "two.mp4:ready"]);
  });

  it("downloads an asset again when its cached copy was evicted or is truncated", async () => {
    const { deps, cache, fetched } = harness();
    await deps.cache("zvid-sample:test:one", new Blob(["first"]));
    await loadSampleAssets(MANIFEST.assets, deps, { concurrency: 1 });
    assert.deepEqual(fetched, [
      "/samples/test/one.mp4",
      "/samples/test/two.mp4",
    ]);
    assert.equal(
      await cache.get("zvid-sample:test:one")?.text(),
      "first asset",
    );
  });

  it("reports a failed asset without stopping the others, and a retry only downloads it", async () => {
    const flaky = harness({ failing: new Set(["/samples/test/one.mp4"]) });
    const failures: string[] = [];
    const result = await loadSampleAssets(MANIFEST.assets, flaky.deps, {
      onAsset: (event) => {
        if (event.phase === "failed") {
          failures.push(event.error.message);
        }
      },
    });
    assert.deepEqual(
      result.failed.map((asset) => asset.name),
      ["one.mp4"],
    );
    assert.deepEqual(failures, ["Could not download one.mp4: Failed to fetch"]);
    assert.ok(flaky.cache.has("zvid-sample:test:two"));

    const retry = harness();
    for (const [id, blob] of flaky.cache) {
      await retry.deps.cache(id, blob);
    }
    await loadSampleAssets(MANIFEST.assets, retry.deps);
    assert.deepEqual(retry.fetched, ["/samples/test/one.mp4"]);
  });

  it("fails bytes that don't match the manifest and caches nothing for them", async () => {
    const { deps, cache } = harness({
      bodies: {
        "/samples/test/one.mp4": "first assex",
        "/samples/test/two.mp4": "the second asset",
      },
    });
    const failures: string[] = [];
    await loadSampleAssets(MANIFEST.assets, deps, {
      onAsset: (event) => {
        if (event.phase === "failed") {
          failures.push(event.error.message);
        }
      },
    });
    assert.match(failures[0] ?? "", /one\.mp4 did not match the sample manifest/);
    assert.equal(cache.has("zvid-sample:test:one"), false);
  });

  it("reports a failed response", async () => {
    const { deps } = harness({ bodies: {} });
    const result = await loadSampleAssets(MANIFEST.assets, deps);
    assert.equal(result.failed.length, 2);
  });

  it("stops when cancelled, without caching or reporting the asset in flight", async () => {
    const controller = new AbortController();
    const { deps, cache } = harness();
    const cancelling: SampleLoadDeps = {
      ...deps,
      async fetch(url, init) {
        controller.abort();
        return deps.fetch(url, init);
      },
    };
    const { events, onAsset } = recordEvents();
    await assert.rejects(
      loadSampleAssets(MANIFEST.assets, cancelling, {
        signal: controller.signal,
        onAsset,
      }),
      SampleLoadCancelledError,
    );
    assert.equal(cache.size, 0);
    assert.equal(
      events.some((event) => /ready|failed/.test(event)),
      false,
    );
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
    // As a harness that normalizes file paths hands it back.
    assert.equal(
      findSampleAsset(MANIFEST, "zvid-sample:\\test\\two.mp4")?.id,
      "zvid-sample:test:two",
    );
    assert.equal(
      findSampleAsset(MANIFEST, ".\\zvid-sample:\\test\\two.mp4")?.id,
      "zvid-sample:test:two",
    );
    assert.equal(
      findSampleAsset(MANIFEST, "zvid-sample:/test/two.mp4")?.id,
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
