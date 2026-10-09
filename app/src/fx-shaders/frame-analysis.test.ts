// The readback drives WebGL.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EffectChainRenderer, wholeTexture } from "./chain.ts";
import {
  FRAME_LEVELS,
  FrameAnalysisHub,
  type FrameSample,
  frameSampleSize,
  histogramCounts,
  waveformCounts,
} from "./frame-analysis.ts";
import { resolveEffectChain } from "./registry.ts";

// A WebGLRenderingContext stand-in that records the framebuffer each draw
// goes to and every readPixels. Constants resolve to their own names, and
// calls it doesn't model are accepted and ignored.
function createReadbackGl() {
  let nextId = 1;
  let framebuffer: unknown = null;
  const draws: unknown[] = [];
  const reads: Array<[number, number]> = [];
  const methods: Record<string, (...args: never[]) => unknown> = {
    createTexture: () => ({ kind: "texture", id: nextId++ }),
    createFramebuffer: () => ({ kind: "framebuffer", id: nextId++ }),
    createShader: () => ({ kind: "shader", id: nextId++ }),
    createProgram: () => ({ kind: "program", id: nextId++ }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    getParameter: () => 4096,
    bindFramebuffer: (_target: unknown, bound: unknown) => {
      framebuffer = bound;
    },
    drawArrays: () => {
      draws.push(framebuffer);
    },
    readPixels: (...args: never[]) => {
      const [, , width, height, , , pixels] = args as unknown as [
        number,
        number,
        number,
        number,
        unknown,
        unknown,
        Uint8Array,
      ];
      reads.push([width, height]);
      pixels.fill(128);
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
  return { gl, draws, reads };
}

function createRenderer(analysis: FrameAnalysisHub | null) {
  const fake = createReadbackGl();
  const renderer = new EffectChainRenderer(fake.gl, {} as WebGLBuffer);
  renderer.analysis = analysis;
  return { ...fake, renderer };
}

const SOURCE = wholeTexture({} as WebGLTexture);

const CONTEXT = {
  time: 0,
  clipProgress: 0,
  resolution: [1920, 1080] as [number, number],
  bottomUp: true,
};

function chain(effects: Array<[string, string, Record<string, number>]>) {
  return resolveEffectChain(
    effects.map(([id, effectName, values]) => ({
      id,
      trackId: "lane",
      effectName,
      parameters: Object.entries(values).map(([key, value]) => ({
        key,
        value: String(value),
        numericValue: value,
      })),
    })),
    "lane",
  );
}

// A hub whose clock the test moves.
function createHub() {
  const clock = { now: 0 };
  const hub = new FrameAnalysisHub({ rate: 10, now: () => clock.now });
  return { hub, clock };
}

// A `width` × `height` sample with every pixel at `rgb`, but for the
// pixels `overrides` sets by index.
function sampleOf(
  width: number,
  height: number,
  rgb: [number, number, number],
  overrides: Record<number, [number, number, number]> = {},
): FrameSample {
  const pixels = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    pixels.set([...(overrides[pixel] ?? rgb), 255], pixel * 4);
  }
  return { width, height, pixels };
}

describe("frameSampleSize", () => {
  it("reads a frame back at 256 columns, keeping its aspect", () => {
    assert.deepEqual(frameSampleSize(1920, 1080), { width: 256, height: 144 });
    assert.deepEqual(frameSampleSize(1080, 1920), { width: 256, height: 256 });
  });

  it("never reads back more than the picture has", () => {
    assert.deepEqual(frameSampleSize(100, 50), { width: 100, height: 50 });
  });
});

describe("waveformCounts", () => {
  it("bins each column's pixels at their levels, per channel", () => {
    // Column 0 is red at 255, column 1 gray at 64 but for one pixel at 0.
    const sample = sampleOf(2, 3, [0, 0, 0], {
      0: [255, 0, 0],
      2: [255, 0, 0],
      4: [255, 0, 0],
      1: [64, 64, 64],
      3: [64, 64, 64],
    });
    const counts = waveformCounts(sample);
    const at = (channel: number, column: number, level: number) =>
      counts[(channel * 2 + column) * FRAME_LEVELS + level];
    assert.equal(at(0, 0, 255), 3);
    assert.equal(at(1, 0, 0), 3);
    assert.equal(at(2, 0, 0), 3);
    for (const channel of [0, 1, 2]) {
      assert.equal(at(channel, 1, 64), 2);
      assert.equal(at(channel, 1, 0), 1);
    }
    assert.equal(
      counts.reduce((sum, count) => sum + count, 0),
      3 * 2 * 3,
    );
  });
});

describe("histogramCounts", () => {
  it("counts the whole sample's pixels at each level, per channel", () => {
    const counts = histogramCounts(
      sampleOf(4, 2, [10, 20, 30], { 0: [0, 0, 0] }),
    );
    assert.equal(counts[10], 7);
    assert.equal(counts[FRAME_LEVELS + 20], 7);
    assert.equal(counts[2 * FRAME_LEVELS + 30], 7);
    assert.equal(counts[0], 1);
  });
});

describe("FrameAnalysisHub", () => {
  it("wants an effect only while something is subscribed to it", () => {
    const { hub } = createHub();
    assert.equal(hub.wants("scopes"), false);
    const unsubscribe = hub.subscribe("scopes", () => {});
    assert.equal(hub.wants("scopes"), true);
    assert.equal(hub.wants("other"), false);
    unsubscribe();
    assert.equal(hub.active, false);
    assert.equal(hub.wants("scopes"), false);
  });

  it("samples an effect at most at its rate", () => {
    const { hub, clock } = createHub();
    hub.subscribe("scopes", () => {});
    assert.equal(hub.wants("scopes"), true);
    clock.now = 50;
    assert.equal(hub.wants("scopes"), false);
    clock.now = 100;
    assert.equal(hub.wants("scopes"), true);
  });

  it("asks a paused preview for a frame when a panel subscribes", async () => {
    const { hub } = createHub();
    let requests = 0;
    const stop = hub.onFrameRequest(() => {
      requests++;
    });
    hub.subscribe("scopes", () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests, 1);
    stop();
  });

  it("publishes a sample to the effect's listeners alone", () => {
    const { hub } = createHub();
    const received: string[] = [];
    hub.subscribe("a", () => received.push("a"));
    hub.subscribe("b", () => received.push("b"));
    hub.publish("a", sampleOf(1, 1, [0, 0, 0]));
    assert.deepEqual(received, ["a"]);
  });
});

describe("Scopes in the effect chain", () => {
  it("is skipped without a hub, as in export, and reads nothing back", () => {
    const { renderer, draws, reads } = createRenderer(null);
    const steps = renderer.prepare(chain([["s", "Scopes", {}]]));
    assert.equal(steps.length, 0);
    assert.equal(renderer.run(SOURCE, 1920, 1080, steps, CONTEXT), SOURCE);
    assert.equal(draws.length, 0);
    assert.equal(reads.length, 0);
  });

  it("is skipped while no panel shows it", () => {
    const { hub } = createHub();
    const { renderer, reads } = createRenderer(hub);
    const steps = renderer.prepare(
      chain([
        ["c", "Colorize", { _HueOffset: 0.25 }],
        ["s", "Scopes", {}],
      ]),
    );
    assert.equal(steps.length, 1);
    renderer.run(SOURCE, 1920, 1080, steps, CONTEXT);
    assert.equal(reads.length, 0);
  });

  it("reads back the picture at its position, leaving it unchanged", () => {
    const { hub } = createHub();
    const samples: FrameSample[] = [];
    hub.subscribe("s", (sample) => samples.push(sample));
    const { renderer, draws, reads } = createRenderer(hub);
    const withScopes = renderer.prepare(
      chain([
        ["c", "Colorize", { _HueOffset: 0.25 }],
        ["s", "Scopes", {}],
      ]),
    );
    const output = renderer.run(SOURCE, 1920, 1080, withScopes, CONTEXT);

    assert.deepEqual(reads, [[256, 144]]);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].width, 256);
    assert.equal(samples[0].pixels.length, 256 * 144 * 4);
    // Colorize draws, then the readback; the result is Colorize's.
    assert.equal(draws.length, 2);
    assert.notEqual(output, SOURCE);
    assert.notEqual(draws[1], draws[0]);
  });

  it("keeps the passes around it from merging across it", () => {
    const { hub } = createHub();
    hub.subscribe("s", () => {});
    const { renderer } = createRenderer(hub);
    const steps = renderer.prepare(
      chain([
        ["a", "Colorize", { _HueOffset: 0.25 }],
        ["s", "Scopes", {}],
        ["b", "Colorize", { _HueOffset: -0.25 }],
      ]),
    );
    assert.deepEqual(
      steps.map((step) => step.analysis ?? step.compiled.pass.effectName),
      ["Colorize", "s", "Colorize"],
    );
  });

  it("copies its input to the screen when it is last on the way there", () => {
    const { hub } = createHub();
    hub.subscribe("s", () => {});
    const { renderer, draws, reads } = createRenderer(hub);
    const steps = renderer.prepare(chain([["s", "Scopes", {}]]));
    renderer.run(SOURCE, 1920, 1080, steps, CONTEXT, "screen");
    assert.equal(reads.length, 1);
    assert.equal(draws.length, 2);
    assert.equal(draws[1], null);
  });
});
