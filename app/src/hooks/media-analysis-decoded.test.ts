import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FollowedElement,
  type FollowerContext,
  MediaAnalysisDecodedFollower,
} from "./media-analysis-decoded.ts";

class FakeElement extends EventTarget {
  currentSrc = "blob:media";
  currentTime = 0;
  paused = true;
  playbackRate = 1;

  emit(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

class FakeSource {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  output: unknown = null;
  startedWith: [number, number] | null = null;
  stopped = false;
  disconnected = false;

  connect(output: unknown) {
    this.output = output;
  }
  start(when: number, offset: number) {
    this.startedWith = [when, offset];
  }
  stop() {
    this.stopped = true;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeContext {
  currentTime = 100;
  sources: FakeSource[] = [];

  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  get playing() {
    return this.sources.filter((source) => !source.stopped);
  }
}

const OUTPUT = { name: "tap input" };

function followerOf(element: FakeElement, duration = 30) {
  const context = new FakeContext();
  const decodes: string[] = [];
  const pending: Array<() => void> = [];
  const follower = new MediaAnalysisDecodedFollower(
    element as unknown as FollowedElement,
    context as unknown as FollowerContext,
    OUTPUT as unknown as AudioNode,
    (url) => {
      decodes.push(url);
      return new Promise((resolve) => {
        pending.push(() =>
          resolve({ duration, url } as unknown as AudioBuffer),
        );
      });
    },
  );
  // Finishes the decodes so far.
  const decoded = async () => {
    for (const finish of pending.splice(0)) {
      finish();
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  return { follower, context, decodes, decoded };
}

describe("MediaAnalysisDecodedFollower", () => {
  it("decodes the element's media", () => {
    const { decodes } = followerOf(new FakeElement());
    assert.deepEqual(decodes, ["blob:media"]);
  });

  it("plays the buffer into the tap from where the playing element is", async () => {
    const element = new FakeElement();
    element.paused = false;
    element.currentTime = 4;
    const { context, decoded } = followerOf(element);
    assert.equal(context.sources.length, 0);
    await decoded();
    const [source] = context.playing;
    assert.deepEqual(source.startedWith, [0, 4]);
    assert.equal(source.output, OUTPUT);
    assert.equal((source.buffer as { url: string }).url, "blob:media");
  });

  it("follows play, pause and seeks", async () => {
    const element = new FakeElement();
    const { context, decoded } = followerOf(element);
    await decoded();
    assert.equal(context.playing.length, 0);

    element.paused = false;
    element.currentTime = 2;
    element.emit("play");
    assert.equal(context.playing.length, 1);
    assert.deepEqual(context.playing[0].startedWith, [0, 2]);

    element.currentTime = 12;
    element.emit("seeking");
    assert.equal(context.playing.length, 1);
    assert.deepEqual(context.playing[0].startedWith, [0, 12]);
    assert.equal(context.sources[0].disconnected, true);

    element.paused = true;
    element.emit("pause");
    assert.equal(context.playing.length, 0);
  });

  it("plays at the element's rate", async () => {
    const element = new FakeElement();
    element.paused = false;
    const { context, decoded } = followerOf(element);
    await decoded();
    element.playbackRate = 2;
    element.emit("ratechange");
    assert.equal(context.playing[0].playbackRate.value, 2);
  });

  it("restarts only once it drifts more than a second from the element", async () => {
    const element = new FakeElement();
    element.paused = false;
    const { context, decoded } = followerOf(element);
    await decoded();

    context.currentTime += 5;
    element.currentTime = 5.9;
    element.emit("timeupdate");
    assert.equal(context.sources.length, 1);

    context.currentTime += 1;
    element.currentTime = 8;
    element.emit("timeupdate");
    assert.equal(context.sources.length, 2);
    assert.deepEqual(context.playing[0].startedWith, [0, 8]);
  });

  it("keeps time at the element's rate", async () => {
    const element = new FakeElement();
    element.paused = false;
    element.playbackRate = 2;
    const { context, decoded } = followerOf(element);
    await decoded();
    context.currentTime += 3;
    element.currentTime = 6;
    element.emit("timeupdate");
    assert.equal(context.sources.length, 1);
  });

  it("stays silent past the end of the media", async () => {
    const element = new FakeElement();
    element.paused = false;
    element.currentTime = 31;
    const { context, decoded } = followerOf(element, 30);
    await decoded();
    assert.equal(context.sources.length, 0);
  });

  it("decodes the new media when the element's source changes", async () => {
    const element = new FakeElement();
    element.paused = false;
    const { context, decodes, decoded } = followerOf(element);
    await decoded();
    assert.equal(context.playing.length, 1);

    element.currentSrc = "blob:other";
    element.emit("loadstart");
    assert.deepEqual(decodes, ["blob:media", "blob:other"]);
    assert.equal(context.playing.length, 0);
    element.emit("timeupdate");
    assert.equal(context.playing.length, 0);

    await decoded();
    assert.equal(
      (context.playing[0].buffer as { url: string }).url,
      "blob:other",
    );
  });

  it("drops a decode that finishes after the source has changed", async () => {
    const element = new FakeElement();
    element.paused = false;
    const { context, decoded } = followerOf(element);
    element.currentSrc = "blob:other";
    element.emit("loadstart");
    await decoded();
    assert.equal(context.playing.length, 1);
    assert.equal(
      (context.playing[0].buffer as { url: string }).url,
      "blob:other",
    );
  });

  it("stops and stops following on dispose", async () => {
    const element = new FakeElement();
    element.paused = false;
    const { follower, context, decoded } = followerOf(element);
    await decoded();
    follower.dispose();
    assert.equal(context.playing.length, 0);
    element.emit("play");
    assert.equal(context.playing.length, 0);
  });

  it("ignores a decode that finishes after dispose", async () => {
    const element = new FakeElement();
    element.paused = false;
    const { follower, context, decoded } = followerOf(element);
    follower.dispose();
    await decoded();
    assert.equal(context.sources.length, 0);
  });
});
