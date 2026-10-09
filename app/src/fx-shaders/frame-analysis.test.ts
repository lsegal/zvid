// The chain reads pictures back through WebGL.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EffectChainRenderer, wholeTexture } from "./chain.ts";
import {
  ANALYSIS_SIZE,
  countHistogram,
  type FrameHistogram,
  HISTOGRAM_BINS,
  onFrameHistogramWatch,
  watchFrameHistogram,
} from "./frame-analysis.ts";
import { type ChainEffect, resolveEffectChain } from "./registry.ts";

// A WebGLRenderingContext stand-in that records the pixels read back, and
// fills them with one opaque color. Constants resolve to their own names,
// and calls it doesn't model are accepted and ignored.
function createReadingGl(color: [number, number, number] = [255, 0, 0]) {
  const reads: Array<[number, number]> = [];
  let nextId = 1;
  const methods: Record<string, (...args: never[]) => unknown> = {
    createTexture: () => ({ id: nextId++ }),
    createFramebuffer: () => ({ id: nextId++ }),
    createShader: () => ({ id: nextId++ }),
    createProgram: () => ({ id: nextId++ }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    getParameter: () => 4096,
    readPixels: (...args: never[]) => {
      const [, , width, height, , , pixels] = args as unknown as [
        number,
        number,
        number,
        number,
        string,
        string,
        Uint8Array,
      ];
      reads.push([width, height]);
      for (let index = 0; index < pixels.length; index += 4) {
        pixels.set([...color, 255], index);
      }
    },
  };
  const gl = new Proxy(methods, {
    get(target, property) {
      if (typeof property !== "string") return undefined;
      if (property in target) return target[property];
      if (/^[A-Z0-9_]+$/.test(property)) return property;
      return () => undefined;
    },
  }) as unknown as WebGLRenderingContext;
  return { gl, reads };
}

const CONTEXT = {
  time: 0,
  clipProgress: 0,
  resolution: [1, 1] as [number, number],
  bottomUp: false,
};

function levels(id: string, values: Record<string, number> = {}): ChainEffect {
  return {
    id,
    trackId: "lane",
    effectName: "Levels",
    parameters: Object.entries(values).map(([key, value]) => ({
      key,
      value: String(value),
      numericValue: value,
    })),
  };
}

describe("countHistogram", () => {
  it("bins each channel and luminance, weighted by alpha", () => {
    const histogram = countHistogram(
      Uint8Array.from([
        // Opaque white, opaque black, and a transparent red that counts
        // for nothing.
        255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 0,
      ]),
    );
    for (const bins of Object.values(histogram)) {
      assert.equal(bins.length, HISTOGRAM_BINS);
      assert.equal(bins[0], 0.5);
      assert.equal(bins[HISTOGRAM_BINS - 1], 0.5);
    }
  });

  it("leaves a fully transparent picture empty", () => {
    const histogram = countHistogram(new Uint8Array(16));
    assert.ok(histogram.luma.every((value) => value === 0));
  });
});

describe("EffectChainRenderer frame analysis", () => {
  it("reads back a small copy of the picture reaching a watched effect", () => {
    const { gl, reads } = createReadingGl();
    const renderer = new EffectChainRenderer(gl, {} as WebGLBuffer);
    renderer.frameAnalysis = true;
    const received: FrameHistogram[] = [];
    const stop = watchFrameHistogram("watched", (histogram) =>
      received.push(histogram),
    );
    try {
      // At its defaults Levels changes nothing, but the picture reaching it
      // is still read back.
      const steps = renderer.prepare(
        resolveEffectChain([levels("watched")], "lane"),
      );
      assert.deepEqual(
        steps.map((step) => step.effectId),
        ["watched"],
      );
      const source = wholeTexture({} as WebGLTexture);
      renderer.run(source, 1920, 1080, steps, CONTEXT);
      assert.deepEqual(reads, [[ANALYSIS_SIZE, 72]]);
      assert.equal(received.length, 1);
      assert.equal(received[0].red[HISTOGRAM_BINS - 1], 1);
      assert.equal(received[0].green[0], 1);
      // Not again until the interval has passed.
      renderer.run(source, 1920, 1080, steps, CONTEXT);
      assert.equal(reads.length, 1);
    } finally {
      stop();
    }
  });

  it("reads nothing back for an effect nobody watches, or for export", () => {
    const { gl, reads } = createReadingGl();
    const preview = new EffectChainRenderer(gl, {} as WebGLBuffer);
    preview.frameAnalysis = true;
    assert.deepEqual(
      preview.prepare(resolveEffectChain([levels("unwatched")], "lane")),
      [],
    );
    const exporter = new EffectChainRenderer(gl, {} as WebGLBuffer);
    const stop = watchFrameHistogram("exported", () => {});
    try {
      const steps = exporter.prepare(
        resolveEffectChain([levels("exported", { GainY: 2 })], "lane"),
      );
      assert.equal(steps.length, 1);
      assert.equal(steps[0].effectId, undefined);
      exporter.run(wholeTexture({} as WebGLTexture), 64, 64, steps, CONTEXT);
      assert.deepEqual(reads, []);
    } finally {
      stop();
    }
  });

  it("starts a run of its own at a watched effect, so its input is drawn", () => {
    const { gl } = createReadingGl();
    const renderer = new EffectChainRenderer(gl, {} as WebGLBuffer);
    renderer.frameAnalysis = true;
    const chain = resolveEffectChain(
      [
        {
          trackId: "lane",
          effectName: "Colorize",
          parameters: [{ key: "_HueOffset", value: "0.25" }],
        },
        levels("after", { GainY: 2 }),
      ],
      "lane",
    );
    // Once their merged program is ready, the two draw as one.
    renderer.prepare(chain);
    assert.equal(renderer.prepare(chain).length, 1);
    const stop = watchFrameHistogram("after", () => {});
    try {
      assert.deepEqual(
        renderer
          .prepare(chain)
          .map((step) => [step.compiled.pass.effectName, step.effectId]),
        [
          ["Colorize", undefined],
          ["Levels", "after"],
        ],
      );
    } finally {
      stop();
    }
  });
});

describe("watchFrameHistogram", () => {
  it("tells the preview when a panel starts watching, and hands the last histogram to a new watcher", () => {
    let watches = 0;
    const stopListening = onFrameHistogramWatch(() => watches++);
    const { gl } = createReadingGl([0, 0, 255]);
    const renderer = new EffectChainRenderer(gl, {} as WebGLBuffer);
    renderer.frameAnalysis = true;
    const stopFirst = watchFrameHistogram("shared", () => {});
    assert.equal(watches, 1);
    const steps = renderer.prepare(
      resolveEffectChain([levels("shared")], "lane"),
    );
    renderer.run(wholeTexture({} as WebGLTexture), 8, 8, steps, CONTEXT);
    let last: FrameHistogram | undefined;
    const stopSecond = watchFrameHistogram("shared", (histogram) => {
      last = histogram;
    });
    assert.equal(watches, 2);
    assert.equal(last?.blue[HISTOGRAM_BINS - 1], 1);
    stopFirst();
    stopSecond();
    stopListening();
  });
});
