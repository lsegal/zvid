import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolvePreviewPixelRatio,
  syncCanvasSurface,
} from "./composition-canvas.ts";

const HD = { width: 1920, height: 1080 };

describe("resolvePreviewPixelRatio", () => {
  it("covers the panel's device pixels rather than the output at the density", () => {
    const ratio = resolvePreviewPixelRatio(HD, { width: 640, height: 360 }, 2);
    assert.equal(HD.width * ratio, 1280);
    assert.equal(HD.height * ratio, 720);
  });

  it("fits the output's aspect into a panel of another shape", () => {
    const wide = resolvePreviewPixelRatio(HD, { width: 1000, height: 270 }, 2);
    assert.equal(HD.height * wide, 540);
    const tall = resolvePreviewPixelRatio(HD, { width: 480, height: 900 }, 1);
    assert.equal(HD.width * tall, 480);
  });

  it("never exceeds the output size", () => {
    assert.equal(
      resolvePreviewPixelRatio(HD, { width: 1600, height: 900 }, 2),
      1,
    );
  });

  it("previews at output size until the panel is laid out", () => {
    assert.equal(resolvePreviewPixelRatio(HD, { width: 0, height: 0 }, 2), 1);
  });

  it("treats an unknown density as 1", () => {
    const panel = { width: 960, height: 540 };
    assert.equal(resolvePreviewPixelRatio(HD, panel, Number.NaN), 0.5);
    assert.equal(resolvePreviewPixelRatio(HD, panel, 0), 0.5);
  });
});

describe("syncCanvasSurface", () => {
  function fakeCanvas() {
    const writes: string[] = [];
    const style = {
      set aspectRatio(value: string) {
        writes.push(value);
      },
    };
    const canvas = { width: 300, height: 150, style };
    return { canvas: canvas as unknown as HTMLCanvasElement, writes };
  }

  it("sizes the drawing buffer to the output at the pixel ratio", () => {
    const { canvas } = fakeCanvas();
    syncCanvasSurface(canvas, 1920, 1080, 0.5);
    assert.equal(canvas.width, 960);
    assert.equal(canvas.height, 540);
  });

  it("only writes the aspect ratio when it changes", () => {
    const { canvas, writes } = fakeCanvas();
    syncCanvasSurface(canvas, 1920, 1080, 1);
    syncCanvasSurface(canvas, 1920, 1080, 0.5);
    syncCanvasSurface(canvas, 1920, 1080, 0.5);
    assert.deepEqual(writes, ["1920 / 1080"]);
    syncCanvasSurface(canvas, 1080, 1920, 0.5);
    assert.deepEqual(writes, ["1920 / 1080", "1080 / 1920"]);
  });
});
