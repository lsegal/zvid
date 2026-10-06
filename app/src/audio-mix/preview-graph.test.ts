import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimPlaybackAudioSession,
  isIOSWebKit,
  isWebKit,
  mixContextOptions,
} from "./preview-graph.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const MAC_EDGE = `${MAC_CHROME} Edg/129.0.0.0`;
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const FIREFOX =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";

const platform = (userAgent: string, maxTouchPoints = 0) => ({
  userAgent,
  platform: userAgent.includes("Macintosh") ? "MacIntel" : "iPhone",
  maxTouchPoints,
});

describe("isIOSWebKit", () => {
  it("is true on iPhone, and on an iPad that reports a Mac with touch", () => {
    assert.equal(isIOSWebKit(platform(IPHONE, 5)), true);
    assert.equal(isIOSWebKit(platform(IOS_CHROME, 5)), true);
    assert.equal(isIOSWebKit(platform(MAC_SAFARI, 5)), true);
    assert.equal(isIOSWebKit(platform(MAC_SAFARI)), false);
    assert.equal(isIOSWebKit(platform(MAC_CHROME)), false);
    assert.equal(isIOSWebKit(undefined), false);
  });
});

describe("isWebKit", () => {
  it("is true in Safari and every iOS browser, not in Blink or Gecko", () => {
    assert.equal(isWebKit(platform(IPHONE, 5)), true);
    assert.equal(isWebKit(platform(IOS_CHROME, 5)), true);
    assert.equal(isWebKit(platform(MAC_SAFARI)), true);
    assert.equal(isWebKit(platform(MAC_CHROME)), false);
    assert.equal(isWebKit(platform(MAC_EDGE)), false);
    assert.equal(isWebKit(platform(ANDROID_CHROME)), false);
    assert.equal(isWebKit(platform(FIREFOX)), false);
    assert.equal(isWebKit(undefined), false);
  });
});

describe("mixContextOptions", () => {
  it("asks for playback-sized buffers on iOS only", () => {
    assert.deepEqual(mixContextOptions(true), { latencyHint: "playback" });
    assert.deepEqual(mixContextOptions(false), {});
  });
});

describe("claimPlaybackAudioSession", () => {
  it("sets the audio session to playback where there is one", () => {
    const withSession = { audioSession: { type: "auto" } };
    claimPlaybackAudioSession(withSession);
    assert.equal(withSession.audioSession.type, "playback");
    assert.doesNotThrow(() => claimPlaybackAudioSession({}));
    assert.doesNotThrow(() => claimPlaybackAudioSession(undefined));
  });
});
