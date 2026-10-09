// Merging per-pixel passes into the pass before them.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EFFECT_PASSES } from "../fx/effects/index.generated.ts";
import { EffectChainRenderer, wholeTexture } from "./chain.ts";
import { isPerPixelPass, mergedSource } from "./merge.ts";
import { getEffectPass, resolveEffectChain } from "./registry.ts";

// A WebGLRenderingContext stand-in recording shader sources and the float
// uniforms each draw is given. Every program compiles unless
// `failMerged`, which fails merged ones, and `completion` answers the
// parallel-compile status query, when set.
function createGl({
  failMerged = false,
  completion,
}: {
  failMerged?: boolean;
  completion?: () => boolean;
} = {}) {
  let nextId = 1;
  const shaderSources: string[] = [];
  const failed = new Set<unknown>();
  const status = (handle: unknown) => !failed.has(handle);
  const uniforms: Record<string, number> = {};
  const draws: Array<Record<string, number>> = [];
  const methods: Record<string, (...args: never[]) => unknown> = {
    createTexture: () => ({ id: nextId++ }),
    createFramebuffer: () => ({ id: nextId++ }),
    createShader: () => ({ id: nextId++ }),
    createProgram: () => ({ id: nextId++ }),
    shaderSource: (shader: unknown, source: string) => {
      shaderSources.push(source);
      if (failMerged && source.includes("fx0_main")) failed.add(shader);
    },
    attachShader: (program: unknown, shader: unknown) => {
      if (failed.has(shader)) failed.add(program);
    },
    getShaderParameter: status,
    getProgramParameter: (program: unknown, name: string) =>
      name === "COMPLETION_STATUS_KHR"
        ? (completion?.() ?? true)
        : status(program),
    getExtension: (name: string) =>
      completion && name === "KHR_parallel_shader_compile"
        ? { COMPLETION_STATUS_KHR: "COMPLETION_STATUS_KHR" }
        : null,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    getParameter: () => 4096,
    uniform1f: (location: { name: string }, value: number) => {
      uniforms[location.name] = value;
    },
    drawArrays: () => {
      draws.push({ ...uniforms });
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
  return { gl, shaderSources, draws };
}

const CONTEXT = {
  time: 0,
  clipProgress: 0,
  resolution: [1, 1] as [number, number],
  bottomUp: false,
};

function chain(effects: Array<[string, Record<string, number>]>) {
  return resolveEffectChain(
    effects.map(([effectName, values]) => ({
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

const PIXELATE_COLORS = chain([
  ["Pixelate", { _NumPixels: 0.5 }],
  ["Colorize", { _HueOffset: 0.25 }],
  ["NegativeSplit", { _LowIntensity: 0.5, _HighIntensity: 0.75 }],
  ["Colorize", { _HueOffset: -0.5 }],
]);

function names(steps: ReturnType<EffectChainRenderer["prepare"]>) {
  return steps.map((step) => step.compiled.pass.effectName);
}

describe("isPerPixelPass", () => {
  it("finds the passes that read their input only at their own pixel", () => {
    assert.deepEqual(
      EFFECT_PASSES.filter(isPerPixelPass)
        .map((pass) => pass.effectName)
        .sort(),
      ["Colorize", "Contrast", "Exposure", "NegativeSplit", "Shape"],
    );
  });
});

describe("mergedSource", () => {
  const colorize = getEffectPass("Colorize");
  const pixelate = getEffectPass("Pixelate");
  assert.ok(colorize && pixelate);

  it("gives each pass's globals a prefix, so a pass can appear twice", () => {
    const { fragmentSource, uniforms } = mergedSource([
      pixelate,
      colorize,
      colorize,
    ]);
    assert.deepEqual(uniforms, [
      { uRes: "fx0_uRes", uNum: "fx0_uNum" },
      { uHueOffset: "fx1_uHueOffset" },
      { uHueOffset: "fx2_uHueOffset" },
    ]);
    for (const name of [
      "uniform vec2 fx0_uRes",
      "uniform float fx1_uHueOffset",
      "uniform float fx2_uHueOffset",
      "void fx0_main()",
      "void fx1_main()",
      "void fx2_main()",
    ]) {
      assert.ok(fragmentSource.includes(name), name);
    }
    assert.equal(fragmentSource.match(/varying vec2 vUv;/g)?.length, 1);
    assert.doesNotMatch(fragmentSource, /\bprecision\b/);
  });

  it("reads the input only in the first pass, and rounds it in between", () => {
    const { fragmentSource } = mergedSource([pixelate, colorize, colorize]);
    assert.equal(fragmentSource.match(/texture2D\(uTex,/g)?.length, 1);
    assert.equal(fragmentSource.match(/= fxInput;/g)?.length, 2);
    assert.equal(
      fragmentSource.match(/fxInput = fxStored\(fxColor\)/g)?.length,
      2,
    );
    assert.match(fragmentSource, /gl_FragColor = fxColor;\s*}\s*$/);
  });
});

describe("EffectChainRenderer merged passes", () => {
  it("draws a pass and the per-pixel passes after it as one step", () => {
    const recording = createGl();
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    // Unmerged while the merged program compiles.
    assert.equal(renderer.prepare(PIXELATE_COLORS).length, 4);
    const steps = renderer.prepare(PIXELATE_COLORS);
    assert.deepEqual(names(steps), [
      "Pixelate + Colorize + NegativeSplit + Colorize",
    ]);
    // Compiled once.
    renderer.prepare(PIXELATE_COLORS);
    const merged = recording.shaderSources.filter((source) =>
      source.includes("fx0_main"),
    );
    assert.equal(merged.length, 1);
    assert.match(merged[0], /fxTexture2D\(uTex,/);
  });

  it("gives each merged pass its own parameters", () => {
    const recording = createGl();
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    renderer.prepare(PIXELATE_COLORS);
    const steps = renderer.prepare(PIXELATE_COLORS);
    renderer.run(wholeTexture({} as WebGLTexture), 64, 64, steps, CONTEXT);
    assert.equal(recording.draws.length, 1);
    assert.deepEqual(recording.draws[0], {
      fx0_uNum: 0.5,
      fx1_uHueOffset: 0.25,
      fx2_uLow: 0.5,
      fx2_uHigh: 0.75,
      fx3_uHueOffset: -0.5,
    });
  });

  it("starts a new run at a pass that isn't per-pixel, and never at Bloom", () => {
    const renderer = new EffectChainRenderer(createGl().gl, {} as WebGLBuffer);
    const steps = chain([
      ["Bloom", { _Intensity: 0.5 }],
      ["Colorize", { _HueOffset: 0.25 }],
      ["NegativeSplit", { _LowIntensity: 0.5 }],
      ["Pixelate", { _NumPixels: 0.5 }],
      ["Caustics", { _Intensity: 0.5 }],
      ["Colorize", { _HueOffset: 0.5 }],
    ]);
    renderer.prepare(steps);
    assert.deepEqual(names(renderer.prepare(steps)), [
      "Bloom",
      "Colorize + NegativeSplit",
      "Pixelate",
      "Caustics + Colorize",
    ]);
  });

  it("leaves neutral passes out of the run", () => {
    const renderer = new EffectChainRenderer(createGl().gl, {} as WebGLBuffer);
    const steps = chain([
      ["Pixelate", { _NumPixels: 0.5 }],
      ["Colorize", { _HueOffset: 0 }],
      ["NegativeSplit", { _LowIntensity: 0.5 }],
    ]);
    renderer.prepare(steps);
    assert.deepEqual(names(renderer.prepare(steps)), [
      "Pixelate + NegativeSplit",
    ]);
  });

  it("draws every pass on its own with merging off", () => {
    const recording = createGl();
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    renderer.mergePasses = false;
    renderer.prepare(PIXELATE_COLORS);
    assert.equal(renderer.prepare(PIXELATE_COLORS).length, 4);
    assert.ok(
      !recording.shaderSources.some((source) => source.includes("fx0_main")),
    );
  });

  it("waits for the driver to finish the merged program when it can say", () => {
    let done = false;
    const renderer = new EffectChainRenderer(
      createGl({ completion: () => done }).gl,
      {} as WebGLBuffer,
    );
    renderer.prepare(PIXELATE_COLORS);
    assert.equal(renderer.prepare(PIXELATE_COLORS).length, 4);
    done = true;
    assert.equal(renderer.prepare(PIXELATE_COLORS).length, 1);
  });

  it("stays unmerged when the merged program fails to compile", (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const recording = createGl({ failMerged: true });
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    for (let frame = 0; frame < 3; frame++) {
      assert.equal(renderer.prepare(PIXELATE_COLORS).length, 4);
    }
    assert.equal(warn.mock.callCount(), 1);
    // Not tried again.
    assert.equal(
      recording.shaderSources.filter((source) => source.includes("fx0_main"))
        .length,
      1,
    );
  });
});
