import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prefersDecodedVoice } from "./preview-buffer-voice.ts";

describe("prefersDecodedVoice", () => {
  it("takes clips of media known to be at most two minutes long", () => {
    assert.equal(
      prefersDecodedVoice({ durationSeconds: 30, mediaDurationSeconds: 60 }),
      true,
    );
    assert.equal(
      prefersDecodedVoice({ durationSeconds: 30, mediaDurationSeconds: 600 }),
      false,
    );
    // A clip looping short media past the limit.
    assert.equal(
      prefersDecodedVoice({ durationSeconds: 300, mediaDurationSeconds: 10 }),
      false,
    );
    assert.equal(prefersDecodedVoice({ durationSeconds: 30 }), false);
  });
});
