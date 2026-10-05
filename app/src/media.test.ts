import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFallbackMediaItem,
  inferMediaKind,
  isImageMedia,
  mediaBlobSource,
  SVG_MIME_TYPE,
  withMediaType,
} from "./media.ts";

describe("image media", () => {
  it("treats SVG files as images", () => {
    assert.equal(inferMediaKind("Logo.SVG"), "image");
    assert.equal(inferMediaKind("take.mov"), "video");
    assert.equal(inferMediaKind("mix.wav"), "audio");
    assert.equal(isImageMedia({ kind: "image" }), true);
    assert.equal(isImageMedia({ kind: "video" }), false);
  });

  it("opens a session's SVG as an image with no picture or sound", () => {
    const item = buildFallbackMediaItem(
      {
        id: "s",
        name: "logo.svg",
        path: "/art/logo.svg",
        url: "",
        exists: false,
      },
      { color: "#000", accent: "#fff" },
    );
    assert.equal(item.kind, "image");
    assert.equal(item.hasVideo, false);
    assert.equal(item.hasAudio, false);
    assert.equal(item.availability, "offline");
  });

  it("types an SVG blob read back without its MIME type", async () => {
    const untyped = new Blob(["<svg/>"]);
    const typed = withMediaType(untyped, "image");
    assert.equal(typed.type, SVG_MIME_TYPE);
    assert.equal(await typed.text(), "<svg/>");
    assert.equal(mediaBlobSource(typed), untyped);
    const already = new Blob(["<svg/>"], { type: SVG_MIME_TYPE });
    assert.equal(withMediaType(already, "image"), already);
    assert.equal(withMediaType(untyped, "video"), untyped);
  });
});
