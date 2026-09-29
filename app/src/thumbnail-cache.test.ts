import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClipWarp, warpSourceTime } from "./clip-warp.ts";
import {
  createThumbnailCache,
  getClipThumbnailTimeSeconds,
  getThumbnailCacheKey,
  type ThumbnailRequest,
  type ThumbnailSize,
} from "./thumbnail-cache.ts";

type Media = { id: string; url: string };

type PendingDecode = {
  media: Media;
  timeSeconds: number;
  size?: ThumbnailSize;
  resolve: (url: string | undefined) => void;
  reject: (error: Error) => void;
};

function setup(concurrency?: number) {
  const decodes: PendingDecode[] = [];
  const revoked: string[] = [];
  let notifications = 0;
  const cache = createThumbnailCache<Media>({
    generate: (media, timeSeconds, size) =>
      new Promise((resolve, reject) => {
        decodes.push({ media, timeSeconds, size, resolve, reject });
      }),
    revoke: (url) => revoked.push(url),
    concurrency,
    scheduleNotify: (notify) => notify(),
  });
  cache.subscribe(() => {
    notifications += 1;
  });
  return {
    cache,
    decodes,
    revoked,
    get notifications() {
      return notifications;
    },
  };
}

const media: Media = { id: "m1", url: "blob:media" };

function request(
  owner: string,
  timeSeconds: number,
  target: Media = media,
): ThumbnailRequest<Media> {
  return {
    key: getThumbnailCacheKey(target.id, timeSeconds),
    owner,
    media: target,
    sourceUrl: target.url,
    timeSeconds,
  };
}

// Lets awaited decode results land.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("getThumbnailCacheKey", () => {
  it("keys by media and millisecond time", () => {
    assert.equal(getThumbnailCacheKey("m1", 1.23456), "m1:1.235");
    assert.equal(
      getThumbnailCacheKey("m1", 2),
      getThumbnailCacheKey("m1", 2.0001),
    );
    assert.notEqual(
      getThumbnailCacheKey("m1", 2),
      getThumbnailCacheKey("m2", 2),
    );
  });

  it("keys each decoded size separately", () => {
    const tile = { width: 150, height: 84 };
    assert.equal(getThumbnailCacheKey("m1", 2, tile), "m1:2.000@150x84");
    assert.notEqual(
      getThumbnailCacheKey("m1", 2, tile),
      getThumbnailCacheKey("m1", 2),
    );
    assert.notEqual(
      getThumbnailCacheKey("m1", 2, tile),
      getThumbnailCacheKey("m1", 2, { width: 192, height: 108 }),
    );
  });
});

describe("getClipThumbnailTimeSeconds", () => {
  const clip = {
    trimStartSeconds: 4,
    sourceWindowStartSeconds: 2,
    sourceWindowEndSeconds: 10,
  };

  it("uses the clip's in-point", () => {
    assert.equal(getClipThumbnailTimeSeconds(clip, 20), 4);
  });

  it("uses the window start when the clip starts before its window", () => {
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 1 }, 20),
      2,
    );
    assert.equal(
      getClipThumbnailTimeSeconds(
        { ...clip, trimStartSeconds: -3, sourceWindowStartSeconds: -1 },
        20,
      ),
      0,
    );
  });

  it("stays within the window and the media", () => {
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 12 }, 20),
      10,
    );
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 9 }, 8),
      8,
    );
  });

  it("ignores an unknown media duration", () => {
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 9 }, 0),
      9,
    );
  });
});

describe("createThumbnailCache", () => {
  it("decodes a frame shared by several owners once", async () => {
    const { cache, decodes } = setup();
    cache.setWanted([request("span:a", 3), request("clip:b", 3)]);

    assert.equal(decodes.length, 1);
    assert.equal(decodes[0].timeSeconds, 3);
    decodes[0].resolve("blob:thumb-3");
    await flush();

    const snapshot = cache.getSnapshot();
    assert.equal(snapshot.get(getThumbnailCacheKey("m1", 3)), "blob:thumb-3");
  });

  it("decodes a frame once per requested size", async () => {
    const { cache, decodes } = setup();
    const tile = { width: 150, height: 84 };
    cache.setWanted([
      request("clip:a", 3),
      {
        ...request("clip:a:tile:0", 3),
        key: getThumbnailCacheKey("m1", 3, tile),
        size: tile,
      },
      {
        ...request("clip:b:tile:0", 3),
        key: getThumbnailCacheKey("m1", 3, tile),
        size: tile,
      },
    ]);

    assert.equal(decodes.length, 2);
    assert.equal(decodes[0].size, undefined);
    assert.deepEqual(decodes[1].size, tile);
    decodes[0].resolve("blob:portrait");
    decodes[1].resolve("blob:tile");
    await flush();

    const snapshot = cache.getSnapshot();
    assert.equal(snapshot.get(getThumbnailCacheKey("m1", 3)), "blob:portrait");
    assert.equal(
      snapshot.get(getThumbnailCacheKey("m1", 3, tile)),
      "blob:tile",
    );
  });

  it("does not decode a cached frame again", async () => {
    const { cache, decodes } = setup();
    cache.setWanted([request("clip:a", 3)]);
    decodes[0].resolve("blob:thumb-3");
    await flush();

    cache.setWanted([request("clip:a", 3), request("clip:b", 3)]);

    assert.equal(decodes.length, 1);
  });

  it("does not start a running decode twice", async () => {
    const { cache, decodes, revoked } = setup();
    cache.setWanted([request("clip:a", 3)]);
    cache.setWanted([]);
    cache.setWanted([request("clip:a", 3)]);

    assert.equal(decodes.length, 1);
    decodes[0].resolve("blob:thumb-3");
    await flush();

    assert.equal(
      cache.getSnapshot().get(getThumbnailCacheKey("m1", 3)),
      "blob:thumb-3",
    );
    assert.deepEqual(revoked, []);
  });

  it("limits how many decodes run at once", async () => {
    const { cache, decodes } = setup(2);
    cache.setWanted([
      request("clip:a", 1),
      request("clip:b", 2),
      request("clip:c", 3),
    ]);

    assert.equal(decodes.length, 2);
    decodes[0].resolve("blob:thumb-1");
    await flush();

    assert.equal(decodes.length, 3);
    assert.equal(decodes[2].timeSeconds, 3);
  });

  it("skips queued decodes that are no longer wanted", async () => {
    const { cache, decodes } = setup(1);
    cache.setWanted([request("clip:a", 1), request("clip:b", 2)]);
    cache.setWanted([request("clip:a", 1)]);
    decodes[0].resolve("blob:thumb-1");
    await flush();

    assert.equal(decodes.length, 1);
  });

  it("revokes thumbnails that are no longer used", async () => {
    const { cache, decodes, revoked } = setup();
    cache.setWanted([request("clip:a", 1)]);
    decodes[0].resolve("blob:thumb-1");
    await flush();

    cache.setWanted([]);

    assert.deepEqual(revoked, ["blob:thumb-1"]);
    assert.equal(
      cache.getSnapshot().get(getThumbnailCacheKey("m1", 1), "clip:a"),
      undefined,
    );
  });

  it("revokes a finished decode nothing wants any more", async () => {
    const { cache, decodes, revoked } = setup();
    cache.setWanted([request("clip:a", 1)]);
    cache.setWanted([]);
    decodes[0].resolve("blob:thumb-1");
    await flush();

    assert.deepEqual(revoked, ["blob:thumb-1"]);
  });

  it("keeps showing an owner's old frame until its new one is ready", async () => {
    const { cache, decodes, revoked } = setup();
    cache.setWanted([request("clip:a", 1)]);
    decodes[0].resolve("blob:thumb-1");
    await flush();

    cache.setWanted([request("clip:a", 2)]);
    const newKey = getThumbnailCacheKey("m1", 2);
    assert.equal(cache.getSnapshot().get(newKey, "clip:a"), "blob:thumb-1");
    assert.deepEqual(revoked, []);

    decodes[1].resolve("blob:thumb-2");
    await flush();

    assert.equal(cache.getSnapshot().get(newKey, "clip:a"), "blob:thumb-2");
    assert.deepEqual(revoked, ["blob:thumb-1"]);
  });

  it("does not retry a failed decode until the media source changes", async () => {
    const { cache, decodes } = setup();
    cache.setWanted([request("clip:a", 1)]);
    decodes[0].reject(new Error("decode failed"));
    await flush();

    cache.setWanted([request("clip:a", 1)]);
    assert.equal(decodes.length, 1);
    assert.equal(
      cache.getSnapshot().get(getThumbnailCacheKey("m1", 1), "clip:a"),
      undefined,
    );

    cache.setWanted([request("clip:a", 1, { ...media, url: "blob:relinked" })]);
    assert.equal(decodes.length, 2);
  });

  it("publishes a new snapshot when a thumbnail is ready", async () => {
    const state = setup();
    state.cache.setWanted([request("clip:a", 1)]);
    const before = state.cache.getSnapshot();
    const notificationsBefore = state.notifications;
    state.decodes[0].resolve("blob:thumb-1");
    await flush();

    assert.notEqual(state.cache.getSnapshot(), before);
    assert.equal(state.notifications, notificationsBefore + 1);
  });

  it("revokes everything on clear and discards decodes already running", async () => {
    const { cache, decodes, revoked } = setup();
    cache.setWanted([request("clip:a", 1), request("clip:b", 2)]);
    decodes[0].resolve("blob:thumb-1");
    await flush();

    cache.clear();
    decodes[1].resolve("blob:thumb-2");
    await flush();

    assert.deepEqual(revoked.sort(), ["blob:thumb-1", "blob:thumb-2"]);
    assert.equal(
      cache.getSnapshot().get(getThumbnailCacheKey("m1", 1)),
      undefined,
    );

    cache.setWanted([request("clip:a", 1)]);
    assert.equal(decodes.length, 3);
  });
});

describe("getClipThumbnailTimeSeconds with a warp", () => {
  const bpm = 120;
  // Two beats per song second. The source plays at 0.5× until beat 4, source
  // second 1, then at 2×, so linear time t maps to 0.5t below 2 s and to
  // 2t - 3 from there.
  const warp = createClipWarp(
    [
      { beatTime: 0, secTime: 0 },
      { beatTime: 4, secTime: 1 },
      { beatTime: 8, secTime: 5 },
    ],
    0,
    0,
    bpm,
  );
  assert.ok(warp);
  const clip = {
    trimStartSeconds: 3,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 10,
    warp,
  };

  it("maps the in-point through the warp markers", () => {
    assert.equal(getClipThumbnailTimeSeconds(clip, 20, bpm), 3);
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 1 }, 20, bpm),
      0.5,
    );
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 4 }, 20, bpm),
      warpSourceTime(warp, 4, bpm).seconds,
    );
  });

  it("keeps the window in linear time and the media bound in warped time", () => {
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 12 }, 20, bpm),
      17,
    );
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 5 }, 6, bpm),
      6,
    );
  });

  it("stays linear without a tempo", () => {
    assert.equal(
      getClipThumbnailTimeSeconds({ ...clip, trimStartSeconds: 1 }, 20),
      1,
    );
  });
});
