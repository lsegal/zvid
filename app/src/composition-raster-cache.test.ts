import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PREVIEW_RASTERS_PER_CLIP,
  plainEqual,
  RasterCache,
  type RasterKind,
} from "./composition-raster-cache.ts";

// Contents are labels; ones sharing a letter animate into each other, and
// a raster stands in for content within one of its number.
const LABELS: RasterKind<string> = {
  same: (a, b) => a === b,
  animates: (a, b) => a[0] === b[0],
  near: (a, b) => Math.abs(Number(a.slice(1)) - Number(b.slice(1))) <= 1,
};

const SIZE = { width: 100, height: 50, scale: 1 };

// Looks `content` up and draws it when no raster will do. Returns the
// texture drawn from and whether a new raster was drawn.
function draw(
  cache: RasterCache,
  content: string,
  preview = true,
  size = SIZE,
) {
  const found = cache.lookup("clip", LABELS, content, size, size, preview);
  if (found.raster) {
    return { textureId: found.raster.textureId, drawn: false };
  }
  cache.store("clip", found.textureId, content, size);
  return { textureId: found.textureId, drawn: true };
}

describe("RasterCache", () => {
  it("draws into the clip's own texture first", () => {
    assert.deepEqual(draw(new RasterCache(), "a0"), {
      textureId: "clip",
      drawn: true,
    });
  });

  it("stands a nearby raster in only while the content animates", () => {
    const cache = new RasterCache();
    draw(cache, "a0");
    assert.equal(draw(cache, "a1").drawn, false);
    // Held still, it is drawn exactly.
    assert.equal(draw(cache, "a1").drawn, true);
    // Out of reach of every raster, it is drawn.
    assert.equal(draw(cache, "a5").drawn, true);
  });

  it("never stands one in for export", () => {
    const cache = new RasterCache();
    draw(cache, "a0", false);
    assert.deepEqual(draw(cache, "a1", false), {
      textureId: "clip",
      drawn: true,
    });
  });

  it("stretches a raster at most one and a half times", () => {
    const cache = new RasterCache();
    draw(cache, "a0");
    const wider = { ...SIZE, width: 150 };
    assert.equal(draw(cache, "a0", true, wider).drawn, false);
    const widest = { ...SIZE, width: 151 };
    assert.equal(draw(cache, "a0", true, widest).drawn, true);
  });

  it("keeps a few rasters while animating, drawing over the oldest", () => {
    const cache = new RasterCache();
    const textures = new Set<string>();
    for (let step = 0; step < PREVIEW_RASTERS_PER_CLIP + 2; step++) {
      textures.add(draw(cache, `a${step * 3}`).textureId);
    }
    assert.equal(textures.size, PREVIEW_RASTERS_PER_CLIP);
    // The first rasters were drawn over.
    assert.equal(draw(cache, "a0").drawn, true);
  });

  it("forgets a released texture's raster and draws into it again", () => {
    const cache = new RasterCache();
    for (const content of ["a0", "a3", "a6"]) {
      draw(cache, content);
    }
    cache.release("clip#raster-1");
    // a3's raster is gone, and its texture is the first free one again.
    assert.deepEqual(draw(cache, "a3"), {
      textureId: "clip#raster-1",
      drawn: true,
    });
    assert.deepEqual(draw(cache, "a9"), {
      textureId: "clip#raster-3",
      drawn: true,
    });
    for (const textureId of ["clip", "clip#raster-1", "clip#raster-2"]) {
      cache.release(textureId);
    }
    cache.release("clip#raster-3");
    assert.equal(cache.size, 0);
  });

  it("draws over rasters of content it no longer animates from", () => {
    const cache = new RasterCache();
    draw(cache, "a0");
    assert.deepEqual(draw(cache, "b0"), { textureId: "clip", drawn: true });
  });
});

describe("plainEqual", () => {
  it("compares nested objects and arrays field by field", () => {
    const style = { size: 1, stops: [{ offset: 0, color: { r: 1 } }] };
    assert.ok(plainEqual(style, structuredClone(style)));
    assert.ok(
      !plainEqual(style, { size: 1, stops: [{ offset: 0, color: { r: 2 } }] }),
    );
    assert.ok(!plainEqual(style, { ...style, stops: [] }));
  });

  it("treats a missing field as undefined", () => {
    assert.ok(plainEqual({ a: 1, b: undefined }, { a: 1 }));
    assert.ok(!plainEqual({ a: 1 }, { a: 1, b: 2 }));
  });

  it("leaves out the top-level keys it skips", () => {
    assert.ok(plainEqual({ a: 1, b: 2 }, { a: 1, b: 3 }, new Set(["b"])));
  });
});
