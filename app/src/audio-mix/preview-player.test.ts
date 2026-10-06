import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWebMMedia,
  type Player,
  playbackDriftTolerance,
  seekPlayer,
} from "./preview-player.ts";

// An element that plays from where it was put, recording its seeks.
function fakePlayer(stalls: boolean) {
  const element = {
    currentTime: 0,
    paused: true,
    seeking: false,
    playbackRate: 1,
    seeks: [] as number[],
  };
  const tracked = new Proxy(element, {
    set(target, key, value) {
      if (key === "currentTime") {
        target.seeks.push(value);
      }
      return Reflect.set(target, key, value);
    },
  });
  const player = {
    element: tracked as unknown as HTMLMediaElement,
    source: {} as MediaElementAudioSourceNode,
    video: false,
    seekStartedAt: null,
    stalls,
  } satisfies Player;
  return { player, element };
}

const TOLERANCE = 0.18;

function sync(player: Player, mediaTime: number, contextTime: number) {
  seekPlayer(
    player,
    mediaTime,
    TOLERANCE,
    true,
    0,
    { currentTime: contextTime } as AudioContext,
    0,
  );
}

describe("seekPlayer", () => {
  it("lets a WebKit element drift up to 0.6 s in steady playback", () => {
    const { player, element } = fakePlayer(true);
    sync(player, 0, 0);
    element.paused = false;
    // Frozen for 0.3 s after starting, as WebKit's are.
    element.currentTime = 0.3;
    element.seeks = [];
    sync(player, 0.85, 0.85);
    assert.deepEqual(element.seeks, []);
    sync(player, 0.95, 0.95);
    assert.deepEqual(element.seeks, [0.95]);
  });

  it("re-syncs other elements once they drift 0.18 s", () => {
    const { player, element } = fakePlayer(false);
    sync(player, 0, 0);
    element.paused = false;
    element.currentTime = 0.3;
    element.seeks = [];
    sync(player, 0.45, 0.45);
    assert.deepEqual(element.seeks, []);
    sync(player, 0.5, 0.5);
    assert.deepEqual(element.seeks, [0.5]);
  });

  it("holds a WebKit element to a scrub's tolerance", () => {
    const { player, element } = fakePlayer(true);
    element.currentTime = 1;
    seekPlayer(player, 1.1, 0.035, false, 0, undefined, 0);
    assert.deepEqual(element.seeks, [1.1]);
  });
});

describe("playbackDriftTolerance", () => {
  it("tolerates more drift in playback than in a scrub", () => {
    const tolerance = (
      isAudibleScrubbing: boolean,
      isContinuousScrubbing = false,
    ) => playbackDriftTolerance({ isAudibleScrubbing, isContinuousScrubbing });
    assert.equal(tolerance(false), 0.18);
    assert.equal(tolerance(true), 0.035);
    assert.equal(tolerance(true, true), 0.1);
  });
});

describe("isWebMMedia", () => {
  it("knows WebM media by its container or its file name", () => {
    assert.equal(isWebMMedia({ id: "a", container: "WebM" }), true);
    assert.equal(isWebMMedia({ id: "b", name: "Take 1.WEBM" }), true);
    assert.equal(isWebMMedia({ id: "c", name: "take.mp4" }), false);
    assert.equal(
      isWebMMedia({ id: "d", name: "take.mov", container: "QuickTime / MOV" }),
      false,
    );
    assert.equal(isWebMMedia({ id: "e" }), false);
  });
});
