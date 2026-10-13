import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLottieName,
  lottieFrameIndex,
  lottieSeconds,
  parseLottie,
} from "./lottie.ts";

const LOTTIE = { v: "5.7.0", fr: 30, ip: 0, op: 45, w: 64, h: 32, layers: [] };

describe("Lottie animations", () => {
  it("are read from JSON files", () => {
    assert.equal(isLottieName("Spinner.JSON"), true);
    assert.equal(isLottieName("spinner.gif"), false);
  });

  it("are told apart from other JSON by their content", () => {
    assert.deepEqual(parseLottie(JSON.stringify(LOTTIE)), LOTTIE);
    // A session, a Lottie missing its layers or frame rate, and non-JSON.
    assert.equal(
      parseLottie(JSON.stringify({ tracks: [], bpm: 120 })),
      undefined,
    );
    assert.equal(
      parseLottie(JSON.stringify({ ...LOTTIE, layers: undefined })),
      undefined,
    );
    assert.equal(parseLottie(JSON.stringify({ ...LOTTIE, fr: 0 })), undefined);
    assert.equal(parseLottie(JSON.stringify({ ...LOTTIE, op: 0 })), undefined);
    assert.equal(parseLottie("[1, 2]"), undefined);
    assert.equal(parseLottie("not json"), undefined);
  });

  it("are as long as their in to out frames", () => {
    assert.equal(lottieSeconds(LOTTIE), 1.5);
    assert.equal(lottieSeconds({ ...LOTTIE, ip: 15 }), 1);
  });

  it("show the frame at a time into them, looping past their end", () => {
    assert.equal(lottieFrameIndex(LOTTIE, 0), 0);
    assert.equal(lottieFrameIndex(LOTTIE, 0.5), 15);
    assert.equal(lottieFrameIndex(LOTTIE, 1.49), 44);
    assert.equal(lottieFrameIndex(LOTTIE, 1.5), 0);
    assert.equal(lottieFrameIndex(LOTTIE, 2), 15);
    assert.equal(lottieFrameIndex(LOTTIE, -0.5), 30);
  });
});
