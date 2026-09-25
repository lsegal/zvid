import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createThumbnailCache,
  getClipThumbnailTimeSeconds,
  getThumbnailCacheKey,
  type ThumbnailRequest,
} from "./thumbnail-cache.ts";

type Media = { id: string; url: string };

type PendingDecode = {
  media: Media;
  timeSeconds: number;
  resolve: (url: string | undefined) => void;
  reject: (error: Error) => void;
};

function setup(concurrency?: number) {
  const decodes: PendingDecode[] = [];
  const revoked: string[] = [];
  let notifications = 0;
  const cache = createThumbnailCache<Media>({
    generate: (media, timeSeconds) =>
      new Promise((resolve, reject) => {
        decodes.push({ media, timeSeconds, resolve, reject });
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
