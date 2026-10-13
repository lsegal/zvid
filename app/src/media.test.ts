import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFallbackMediaItem,
  inferMediaKind,
  isEffectMedia,
  isImageMedia,
  isSvgMedia,
  mediaBlobSource,
  SVG_MIME_TYPE,
  withMediaType,
} from "./media.ts";

describe("image media", () => {
  it("treats SVG and raster image files as images", () => {
    assert.equal(inferMediaKind("Logo.SVG"), "image");
    for (const name of ["a.jpg", "a.JPEG", "a.png", "a.webp", "a.gif"]) {
      assert.equal(inferMediaKind(name), "image", name);
    }
    assert.equal(inferMediaKind("spinner.json"), "image");
    assert.equal(inferMediaKind("take.mov"), "video");
    assert.equal(inferMediaKind("mix.wav"), "audio");
    assert.equal(inferMediaKind("voice.opus"), "audio");
    assert.equal(inferMediaKind("voice.OGG"), "audio");
    assert.equal(inferMediaKind("take.webm"), "video");
    assert.equal(isImageMedia({ kind: "image" }), true);
    assert.equal(isImageMedia({ kind: "video" }), false);
  });

  it("makes clips of images but not of LUTs", () => {
    assert.equal(isEffectMedia({ kind: "image" }), false);
    assert.equal(isEffectMedia({ kind: "lut" }), true);
  });

  it("masks Custom shapes with SVG images only", () => {
    assert.equal(isSvgMedia({ kind: "image", name: "logo.svg" }), true);
    assert.equal(isSvgMedia({ kind: "image", name: "photo.png" }), false);
    assert.equal(isSvgMedia({ kind: "video", name: "take.svg" }), false);
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
    const typed = withMediaType(untyped, "logo.svg");
    assert.equal(typed.type, SVG_MIME_TYPE);
    assert.equal(await typed.text(), "<svg/>");
    assert.equal(mediaBlobSource(typed), untyped);
    const already = new Blob(["<svg/>"], { type: SVG_MIME_TYPE });
    assert.equal(withMediaType(already, "logo.svg"), already);
    assert.equal(withMediaType(untyped, "take.mov"), untyped);
  });

  it("types raster images by their extension", () => {
    const untyped = new Blob(["GIF89a"]);
    assert.equal(withMediaType(untyped, "loop.GIF").type, "image/gif");
    assert.equal(withMediaType(untyped, "photo.jpeg").type, "image/jpeg");
    assert.equal(withMediaType(untyped, "still.webp").type, "image/webp");
  });
});
