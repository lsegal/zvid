import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  cancelQueuedSeek,
  needsPlaybackSeek,
  nudgedPlaybackRate,
  seekMediaElement,
  seekWhenReady,
} from "./media-seek.ts";

// A stand-in media element that records seeks and fires events on demand.
function fakeElement(currentTime: number, readyState: number) {
  const listeners = new Map<string, Array<() => void>>();
  const element = {
    currentTime,
    readyState,
    seeks: [] as number[],
    pause() {},
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener),
      );
    },
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return element;
}

function settled(promise: Promise<void>) {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return () => done;
}

describe("seekMediaElement", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = globalThis;
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("resolves right away at the target once the frame is ready", async () => {
    const element = fakeElement(0, 4);
    await seekMediaElement(element as unknown as HTMLMediaElement, 0);
  });

  it("waits for the first frame of an element still loading at the target", async () => {
    const element = fakeElement(0, 0);
    const isDone = settled(
      seekMediaElement(element as unknown as HTMLMediaElement, 0),
    );
    await Promise.resolve();
    assert.equal(isDone(), false);

    element.fire("loadeddata");
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(isDone(), true);
  });
});

describe("needsPlaybackSeek", () => {
  const paused = { isPlaying: false, isScrubbing: false };
  const playing = { isPlaying: true, isScrubbing: false };
  const scrubbing = { isPlaying: true, isScrubbing: true };

  it("seeks paused or scrubbing media to any other time", () => {
    assert.equal(needsPlaybackSeek(0.01, paused), true);
    assert.equal(needsPlaybackSeek(0.01, scrubbing), true);
  });

  it("leaves paused media already at its time alone", () => {
    // As a paused preview syncs after every edit, media the edit didn't move
    // isn't seeked again (#936).
    assert.equal(needsPlaybackSeek(0, paused), false);
    assert.equal(needsPlaybackSeek(0.0005, scrubbing), false);
  });

  it("seeks playing media only once it drifts too far", () => {
    assert.equal(needsPlaybackSeek(0.1, playing), false);
    assert.equal(needsPlaybackSeek(0.2, playing), true);
  });
});

describe("seekWhenReady", () => {
  // A stand-in element that is still seeking until `land` is called.
  function seekingElement(currentTime: number) {
    const element = fakeElement(currentTime, 4) as ReturnType<
      typeof fakeElement
    > & { seeking: boolean; land(): void };
    let time = currentTime;
    element.seeking = false;
    Object.defineProperty(element, "currentTime", {
      get: () => time,
      set: (value: number) => {
        time = value;
        element.seeks.push(value);
        element.seeking = true;
      },
    });
    element.land = () => {
      element.seeking = false;
      element.fire("seeked");
    };
    return element;
  }

  it("seeks an element that isn't seeking right away", () => {
    const element = seekingElement(0);
    seekWhenReady(element as unknown as HTMLMediaElement, 2);
    assert.deepEqual(element.seeks, [2]);
  });

  it("coalesces a scrub's seeks to the latest target once the seek lands", () => {
    const element = seekingElement(0);
    const media = element as unknown as HTMLMediaElement;
    seekWhenReady(media, 1);
    seekWhenReady(media, 2);
    seekWhenReady(media, 3);
    seekWhenReady(media, 4);
    assert.deepEqual(element.seeks, [1]);

    element.land();
    assert.deepEqual(element.seeks, [1, 4]);
    element.land();
    assert.deepEqual(element.seeks, [1, 4]);
  });

  it("drops a queued seek once it is canceled", () => {
    const element = seekingElement(0);
    const media = element as unknown as HTMLMediaElement;
    seekWhenReady(media, 1);
    seekWhenReady(media, 2);
    cancelQueuedSeek(media);
    element.land();
    assert.deepEqual(element.seeks, [1]);
  });
});

describe("nudgedPlaybackRate", () => {
  it("keeps the clip's rate for media within a frame or so of its time", () => {
    assert.equal(nudgedPlaybackRate(1, 0.03), 1);
    assert.equal(nudgedPlaybackRate(2, -0.03), 2);
  });

  it("plays media behind its time faster and media ahead of it slower", () => {
    assert.equal(nudgedPlaybackRate(1, 0.1), 1.05);
    assert.equal(nudgedPlaybackRate(1, -0.1), 0.95);
    assert.equal(nudgedPlaybackRate(2, 0.1), 2.1);
  });

  it("nudges by at most a tenth", () => {
    assert.equal(nudgedPlaybackRate(1, 5), 1.1);
    assert.equal(nudgedPlaybackRate(1, -5), 0.9);
  });
});
