import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeClipMediaState,
  describePreviewMediaState,
  formatClipMediaState,
  isPlaceholderClip,
} from "./clip-media-state.ts";

describe("isPlaceholderClip", () => {
  it("treats clips with no media id or path as placeholders", () => {
    assert.equal(isPlaceholderClip({ mediaPath: "" }), true);
    assert.equal(isPlaceholderClip({ mediaPath: "   " }), true);
    assert.equal(isPlaceholderClip({}), true);
  });

  it("does not treat clips that reference media as placeholders", () => {
    assert.equal(isPlaceholderClip({ mediaPath: "take.mp4" }), false);
    assert.equal(isPlaceholderClip({ mediaPath: "", mediaId: "m1" }), false);
  });
});

describe("describeClipMediaState", () => {
  it("reports placeholders regardless of availability", () => {
    assert.equal(
      describeClipMediaState({ mediaPath: "" }, undefined),
      "placeholder",
    );
  });

  it("keeps offline for clips whose media is missing", () => {
    assert.equal(
      describeClipMediaState({ mediaPath: "take.mp4" }, undefined),
      "offline",
    );
    assert.equal(
      describeClipMediaState(
        { mediaPath: "take.mp4", mediaId: "m1" },
        "offline",
      ),
      "offline",
    );
  });

  it("maps media availability for clips with media", () => {
    const clip = { mediaPath: "take.mp4", mediaId: "m1" };
    assert.equal(describeClipMediaState(clip, "ready"), "online");
    assert.equal(describeClipMediaState(clip, "hydrating"), "hydrating");
  });
});

describe("clip media labels", () => {
  it("labels placeholders as having no media rather than offline", () => {
    assert.equal(formatClipMediaState("placeholder"), "no media");
    assert.equal(formatClipMediaState("offline"), "offline clip");
    assert.equal(formatClipMediaState("hydrating"), "hydrating...");
  });

  it("explains that a placeholder has no video linked yet", () => {
    const message = describePreviewMediaState("placeholder");
    assert.equal(message.title, "No video linked");
    assert.match(message.detail, /no video linked yet/);
    assert.match(message.detail, /Attach or relink video/);
    assert.doesNotMatch(message.detail, /cached locally/);
  });

  it("keeps the offline wording for missing media", () => {
    const message = describePreviewMediaState("offline");
    assert.equal(message.title, "Offline clip");
    assert.match(message.detail, /not cached locally yet/);
  });
});
