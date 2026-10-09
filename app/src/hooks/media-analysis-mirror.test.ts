import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canMirrorMedia,
  MediaAnalysisMirror,
  type MirrorCopy,
  type MirroredElement,
} from "./media-analysis-mirror.ts";

class FakeElement extends EventTarget {
  currentSrc = "blob:media";
  currentTime = 0;
  paused = true;
  seeking = false;
  playbackRate = 1;
  crossOrigin: string | null = null;

  emit(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

class FakeCopy {
  src = "";
  currentTime = 0;
  paused = true;
  seeking = false;
  playbackRate = 1;
  crossOrigin: string | null = null;
  preload = "";
  seeks: number[] = [];
  plays = 0;
  loads = 0;

  setTime(seconds: number) {
    this.currentTime = seconds;
    this.seeks.push(seconds);
  }
  async play() {
    this.plays += 1;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads += 1;
  }
  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
    }
  }
}

function mirrorOf(element: FakeElement) {
  const copy = new FakeCopy();
  // Record the copy's seeks, as opposed to its time moving on its own.
  const tracked = new Proxy(copy, {
    set(target, key, value) {
      if (key === "currentTime") {
        target.setTime(value);
      } else {
        Reflect.set(target, key, value);
      }
      return true;
    },
  });
  const mirror = new MediaAnalysisMirror(
    element as unknown as MirroredElement,
    tracked as unknown as MirrorCopy,
  );
  copy.seeks = [];
  return { mirror, copy };
}

describe("MediaAnalysisMirror", () => {
  it("loads the element's media", () => {
    const element = new FakeElement();
    element.crossOrigin = "anonymous";
    const { copy } = mirrorOf(element);
    assert.equal(copy.src, "blob:media");
    assert.equal(copy.preload, "auto");
    assert.equal(copy.crossOrigin, "anonymous");
  });

  it("plays, pauses and seeks with the element", () => {
    const element = new FakeElement();
    const { copy } = mirrorOf(element);
    element.currentTime = 4;
    element.paused = false;
    element.emit("play");
    assert.equal(copy.paused, false);
    assert.deepEqual(copy.seeks, [4]);

    element.currentTime = 12;
    element.emit("seeking");
    assert.deepEqual(copy.seeks, [4, 12]);

    element.paused = true;
    element.emit("pause");
    assert.equal(copy.paused, true);
  });

  it("follows the element's playback rate", () => {
    const element = new FakeElement();
    const { copy } = mirrorOf(element);
    element.playbackRate = 2;
    element.emit("ratechange");
    assert.equal(copy.playbackRate, 2);
  });

  it("catches up only once it drifts more than a second", () => {
    const element = new FakeElement();
    const { copy } = mirrorOf(element);
    element.paused = false;
    element.emit("play");
    // WebKit freezes a routed element for about 0.3 s after it starts.
    element.currentTime = 10.4;
    copy.currentTime = 10;
    element.emit("timeupdate");
    assert.deepEqual(copy.seeks, []);

    element.currentTime = 11.5;
    element.emit("timeupdate");
    assert.deepEqual(copy.seeks, [11.5]);

    // Not again while that seek is under way.
    copy.seeking = true;
    element.currentTime = 13;
    element.emit("timeupdate");
    assert.deepEqual(copy.seeks, [11.5]);
  });

  it("retries a play the browser refused", () => {
    const element = new FakeElement();
    const { copy } = mirrorOf(element);
    element.paused = false;
    element.emit("play");
    copy.paused = true;
    element.emit("timeupdate");
    assert.equal(copy.plays, 2);
    assert.equal(copy.paused, false);
  });

  it("loads new media the element switches to", () => {
    const element = new FakeElement();
    const { copy } = mirrorOf(element);
    element.currentSrc = "blob:other";
    element.emit("loadstart");
    assert.equal(copy.src, "blob:other");
  });

  it("stops following and unloads once disposed", () => {
    const element = new FakeElement();
    const { mirror, copy } = mirrorOf(element);
    element.paused = false;
    element.emit("play");
    mirror.dispose();
    assert.equal(copy.paused, true);
    assert.equal(copy.src, "");
    assert.equal(copy.loads, 1);

    element.emit("play");
    assert.equal(copy.plays, 1);
  });
});

describe("canMirrorMedia", () => {
  const mp4 = {
    id: "a",
    name: "clip.mp4",
    container: "MPEG-4",
    hasAudio: true,
  };
  const webm = {
    id: "b",
    name: "clip.webm",
    container: "WebM",
    hasAudio: true,
  };

  it("mirrors media with audio", () => {
    assert.equal(canMirrorMedia(mp4, true), true);
    assert.equal(canMirrorMedia(webm, false), true);
  });

  it("skips WebM in WebKit, which plays it silently once routed", () => {
    assert.equal(canMirrorMedia(webm, true), false);
  });

  it("skips media without audio, and no media", () => {
    assert.equal(canMirrorMedia({ ...mp4, hasAudio: false }, false), false);
    assert.equal(canMirrorMedia(undefined, false), false);
  });
});
