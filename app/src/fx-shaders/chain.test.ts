// The effect chain drives WebGL.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketTargetSize,
  EffectChainRenderer,
  MAX_POOLED_TARGETS,
  TARGET_SIZE_BUCKET,
  targetRegion,
  wholeTexture,
} from "./chain.ts";
import { resolveEffectChain } from "./registry.ts";

type Handle = { kind: string; id: number };

// A WebGLRenderingContext stand-in that counts the textures and
// framebuffers alive, and records shader sources, texture sizes and the
// uniforms each draw is given. Constants resolve to their own names, and
// calls it doesn't model are accepted and ignored.
function createCountingGl() {
  let nextId = 1;
  const live = new Set<Handle>();
  const created = { texture: 0, framebuffer: 0 };
  const shaderSources: string[] = [];
  const textureSizes: Array<[number, number]> = [];
  const uniforms: Record<string, number[]> = {};
  const draws: Array<Record<string, number[]>> = [];
  const create = (kind: "texture" | "framebuffer") => () => {
    const handle = { kind, id: nextId++ };
    created[kind]++;
    live.add(handle);
    return handle;
  };
  const release = (handle: Handle) => {
    assert.ok(live.delete(handle), `${handle.kind} freed twice or unknown`);
  };
  const methods: Record<string, (...args: never[]) => unknown> = {
    createTexture: create("texture"),
    createFramebuffer: create("framebuffer"),
    deleteTexture: release,
    deleteFramebuffer: release,
    createShader: () => ({ kind: "shader", id: nextId++ }),
    createProgram: () => ({ kind: "program", id: nextId++ }),
    shaderSource: (_shader: Handle, source: string) => {
      shaderSources.push(source);
    },
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program: Handle, name: string) => ({ name }),
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE",
    getParameter: () => 4096,
    texImage2D: (...args: never[]) => {
      const [, , , width, height] = args as unknown as number[];
      textureSizes.push([width, height]);
    },
    uniform2f: (location: { name: string }, x: number, y: number) => {
      uniforms[location.name] = [x, y];
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
  const liveCount = (kind: string) =>
    [...live].filter((handle) => handle.kind === kind).length;

  return {
    gl,
    created,
    liveCount,
    shaderSources,
    textureSizes,
    draws,
  };
}

const CONTEXT = {
  time: 0,
  clipProgress: 0,
  resolution: [1, 1] as [number, number],
  bottomUp: false,
};

function colorizeChain(renderer: EffectChainRenderer) {
  return renderer.prepare(
    resolveEffectChain(
      [
        {
          trackId: "lane",
          effectName: "Colorize",
          parameters: [
            { key: "_HueOffset", value: "0.25", numericValue: 0.25 },
          ],
        },
      ],
      "lane",
    ),
  );
}

describe("bucketTargetSize", () => {
  it("rounds a side up to the next bucket", () => {
    assert.equal(bucketTargetSize(1, 4096), TARGET_SIZE_BUCKET);
    assert.equal(bucketTargetSize(64, 4096), 64);
    assert.equal(bucketTargetSize(65, 4096), 128);
    assert.equal(bucketTargetSize(1079.5, 4096), 1088);
  });

  it("never rounds past the largest texture, nor below the picture", () => {
    assert.equal(bucketTargetSize(4000, 4000), 4000);
    assert.equal(bucketTargetSize(4001, 4000), 4001);
  });

  it("allocates at exactly the picture's size with a bucket of 1", () => {
    assert.equal(bucketTargetSize(333, 4096, 1), 333);
  });
});

describe("targetRegion", () => {
  const target = {
    framebuffer: {} as WebGLFramebuffer,
    texture: {} as WebGLTexture,
    width: 128,
    height: 64,
  };

  it("maps the picture into its corner and clamps to its last texels", () => {
    const region = targetRegion(target, 100, 64);
    assert.deepEqual(region.uvScale, [100 / 128, 1]);
    // The center of texel 99, as CLAMP_TO_EDGE clamps a 100-wide texture;
    // a picture filling a side leaves it to CLAMP_TO_EDGE itself.
    assert.deepEqual(region.uvMax, [99.5 / 128, 1]);
  });

  it("covers a whole texture exactly", () => {
    const region = targetRegion(target, 128, 64);
    assert.deepEqual(region.uvScale, [1, 1]);
    assert.deepEqual(region.uvMax, [1, 1]);
    assert.deepEqual(wholeTexture(target.texture), region);
  });
});

describe("EffectChainRenderer pooled targets", () => {
  // A layer framed and run through an effect at a size that changes every
  // frame, as a slot does while an Order animates.
  function animate(
    renderer: EffectChainRenderer,
    frames: number,
    size: (frame: number) => [number, number],
  ) {
    const steps = colorizeChain(renderer);
    for (let frame = 0; frame < frames; frame++) {
      const [width, height] = size(frame);
      const layer = renderer.getLayerTarget(width, height);
      renderer.run(layer.region, width, height, steps, CONTEXT);
    }
  }

  it("stays bounded across 200 frames of changing sizes", () => {
    const recording = createCountingGl();
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    renderer.syncSurface(1920, 1080);
    // A slot squishing from nothing to 960×1080, a pixel or two a frame.
    animate(renderer, 200, (frame) => [
      Math.max(1, Math.round(frame * 4.8)),
      1080,
    ]);

    // One layer target and two ping-pong targets per 64 px bucket, with no
    // more than MAX_POOLED_TARGETS buckets of each kept.
    const maxLive = MAX_POOLED_TARGETS * 3;
    assert.ok(recording.liveCount("texture") <= maxLive);
    assert.ok(recording.liveCount("framebuffer") <= maxLive);
    // 15 buckets up to 960 px wide, each allocated once, rather than three
    // targets every frame.
    assert.equal(recording.created.texture, 15 * 3);
    assert.equal(recording.created.framebuffer, 15 * 3);

    renderer.dispose();
    assert.equal(recording.liveCount("texture"), 0);
    assert.equal(recording.liveCount("framebuffer"), 0);
  });

  it("reuses its targets when the animation repeats", () => {
    const recording = createCountingGl();
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    // Within one bucket, in and out again.
    const size = (frame: number): [number, number] => [
      300 + (frame % 20),
      250 - (frame % 10),
    ];
    animate(renderer, 20, size);
    const allocated = recording.created.texture;
    assert.equal(allocated, 3);
    animate(renderer, 200, size);
    assert.equal(recording.created.texture, allocated);
    assert.deepEqual(recording.textureSizes, [
      [320, 256],
      [320, 256],
      [320, 256],
    ]);
  });

  it("samples only the picture in a pooled target's corner", () => {
    const recording = createCountingGl();
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    const steps = colorizeChain(renderer);
    // Every texture2D call in a pass goes through the mapping.
    const fragment = recording.shaderSources.find((source) =>
      source.includes("uFxUvScale"),
    );
    assert.ok(fragment);
    assert.match(fragment, /vec4 fxTexture2D\(sampler2D tex, vec2 uv\)/);
    const body = fragment.slice(fragment.indexOf("}") + 1);
    assert.doesNotMatch(body, /(^|[^x])texture2D\(/);
    assert.match(body, /fxTexture2D\(uTex,/);

    const layer = renderer.getLayerTarget(100, 50);
    renderer.run(layer.region, 100, 50, [...steps, ...steps], CONTEXT);
    // The framed layer, then the first pass's output, both in the corner
    // of a 128×64 target.
    assert.deepEqual(
      recording.draws.map((draw) => [draw.uFxUvScale, draw.uFxUvMax]),
      [
        [
          [100 / 128, 50 / 64],
          [99.5 / 128, 49.5 / 64],
        ],
        [
          [100 / 128, 50 / 64],
          [99.5 / 128, 49.5 / 64],
        ],
      ],
    );
  });

  it("samples a whole source texture unmapped", () => {
    const recording = createCountingGl();
    const renderer = new EffectChainRenderer(recording.gl, {} as WebGLBuffer);
    renderer.run(
      wholeTexture({} as WebGLTexture),
      1920,
      1080,
      colorizeChain(renderer),
      CONTEXT,
    );
    assert.deepEqual(recording.draws[0].uFxUvScale, [1, 1]);
    assert.deepEqual(recording.draws[0].uFxUvMax, [1, 1]);
  });
});
