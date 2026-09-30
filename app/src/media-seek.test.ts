import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { seekMediaElement } from "./media-seek.ts";

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
