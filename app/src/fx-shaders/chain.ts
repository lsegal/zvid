import { renderStats } from "../render-stats.ts";
import {
  FULLSCREEN_VERTEX_SOURCE,
  finishProgram,
  isProgramReady,
  type PendingProgram,
  POSITION_ATTRIBUTE_LOCATION,
  startProgram,
} from "./gl.ts";
import type { EffectChainStep } from "./registry.ts";
import type {
  EffectContext,
  EffectParameter,
  EffectPass,
  EffectUniformLocations,
} from "./types.ts";

// Pooled targets hold their picture in the corner at texture coordinate 0,
// so every pass samples through `fxTexture2D`, which maps a coordinate over
// the picture into it and clamps it to the picture's last texels, as
// CLAMP_TO_EDGE does for a texture of exactly the picture's size.
const FRAGMENT_HEADER = `precision mediump float;
uniform vec2 uFxUvScale;
uniform vec2 uFxUvMax;
vec4 fxTexture2D(sampler2D tex, vec2 uv) {
  return texture2D(tex, min(uv * uFxUvScale, uFxUvMax));
}
`;

// Pooled targets are allocated with sides rounded up to a multiple of this,
// so a slot whose size animates reuses a few targets rather than
// allocating new ones every frame.
export const TARGET_SIZE_BUCKET = 64;

// Pooled sets of targets kept for reuse; the least recently used is freed
// past this.
export const MAX_POOLED_TARGETS = 8;

type CompiledPass = {
  pass: EffectPass;
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
  uvScale: WebGLUniformLocation | null;
  uvMax: WebGLUniformLocation | null;
  locations: EffectUniformLocations;
};

export type PreparedEffectStep = {
  compiled: CompiledPass;
  parameters: EffectParameter[];
};

export type RenderTarget = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
};

// A texture and the part of it a picture fills: `uvScale` of it from
// texture coordinate 0, sampled no further than `uvMax`, the centers of its
// last texels. A whole texture has both at 1.
export type TextureRegion = {
  texture: WebGLTexture;
  uvScale: [number, number];
  uvMax: [number, number];
};

export function wholeTexture(texture: WebGLTexture): TextureRegion {
  return { texture, uvScale: [1, 1], uvMax: [1, 1] };
}

// The `width` × `height` corner of `target`.
export function targetRegion(
  target: RenderTarget,
  width: number,
  height: number,
): TextureRegion {
  const axis = (used: number, size: number) =>
    used >= size ? 1 : (used - 0.5) / size;
  return {
    texture: target.texture,
    uvScale: [width / target.width, height / target.height],
    uvMax: [axis(width, target.width), axis(height, target.height)],
  };
}

// A pooled target's side for a picture `size` pixels long.
export function bucketTargetSize(
  size: number,
  maxSize: number,
  bucket = TARGET_SIZE_BUCKET,
) {
  const whole = Math.max(1, Math.ceil(size));
  return Math.max(whole, Math.min(maxSize, Math.ceil(whole / bucket) * bucket));
}

// Up to MAX_POOLED_TARGETS sets of same-sized targets, the most recently
// used last. A request reuses the smallest set with room for its picture,
// so a slot shrinking and growing again keeps drawing into the same few
// targets, and the least recently used set is freed past the limit.
class TargetPool {
  private sets: RenderTarget[][] = [];
  private readonly release: (set: RenderTarget[]) => void;

  constructor(release: (set: RenderTarget[]) => void) {
    this.release = release;
  }

  get(fits: (target: RenderTarget) => boolean, create: () => RenderTarget[]) {
    const area = (set: RenderTarget[]) => set[0].width * set[0].height;
    let best = -1;
    for (const [index, set] of this.sets.entries()) {
      if (fits(set[0]) && (best < 0 || area(set) < area(this.sets[best]))) {
        best = index;
      }
    }
    const set = best < 0 ? create() : this.sets.splice(best, 1)[0];
    this.sets.push(set);
    while (this.sets.length > MAX_POOLED_TARGETS) {
      this.release(this.sets.shift() as RenderTarget[]);
    }
    return set;
  }

  clear() {
    for (const set of this.sets) {
      this.release(set);
    }
    this.sets = [];
  }
}

// Runs a layer's effect passes by ping-ponging between two framebuffers. One
// instance belongs to one WebGL context: `precompile` starts every program
// up front, any it missed compile on first use, and render targets are reallocated whenever the canvas surface changes size.
// Layer and ping-pong targets come from bounded pools of bucketed sizes, a
// picture drawn into the corner of one (see `targetRegion`).
export class EffectChainRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly positionBuffer: WebGLBuffer;
  // A null entry records a pass that failed to compile; it stays passthrough.
  private programs = new Map<EffectPass, CompiledPass | null>();
  // Programs `precompile` started whose status hasn't been checked yet.
  private pending = new Map<EffectPass, PendingProgram>();
  private readonly parallel: KHR_parallel_shader_compile | null;
  private pingPongTargets: TargetPool;
  private sceneTarget: RenderTarget | null = null;
  private layerTargets: TargetPool;
  // One pool per Order nesting depth, since an arrangement draws into its
  // own target while the one it sits in is still in use.
  private arrangementTargets = new Map<number, TargetPool>();
  private readonly release: (targets: RenderTarget[]) => void;
  // Handed to every pass, refilled for each run rather than allocated.
  private readonly stepContext: EffectContext = {
    time: 0,
    clipProgress: 0,
    resolution: [0, 0],
    bottomUp: false,
  };
  private surfaceKey = "";
  private readonly maxTextureSize: number;
  // Allocates pooled targets at exactly each picture's size and reuses one
  // only for a picture of that size, as targets were before pooling, for
  // tests to compare against.
  exactTargets = false;

  constructor(gl: WebGLRenderingContext, positionBuffer: WebGLBuffer) {
    this.gl = gl;
    this.positionBuffer = positionBuffer;
    this.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
    this.parallel = gl.getExtension("KHR_parallel_shader_compile") ?? null;
    this.release = (targets: RenderTarget[]) => {
      for (const target of targets) {
        this.deleteTarget(target);
      }
    };
    this.pingPongTargets = new TargetPool(this.release);
    this.layerTargets = new TargetPool(this.release);
  }

  // Hands every pass in `passes` to the driver to compile, without waiting,
  // so an effect appearing during playback doesn't stall a frame compiling
  // its program. Their status is checked once `settlePrecompiled` finds them
  // done, or when the pass is first used.
  precompile(passes: readonly EffectPass[]) {
    for (const pass of passes) {
      if (this.programs.has(pass) || this.pending.has(pass)) {
        continue;
      }
      try {
        this.pending.set(pass, this.startPass(pass));
      } catch (error) {
        this.failPass(pass, error);
      }
    }
  }

  // Checks the precompiled programs the driver reports finished, which never
  // waits. Without KHR_parallel_shader_compile the driver can't be asked, so
  // each is checked on first use instead.
  settlePrecompiled() {
    if (!this.parallel || !this.pending.size) {
      return;
    }
    for (const [pass, pending] of this.pending) {
      if (isProgramReady(this.gl, this.parallel, pending)) {
        this.getCompiledPass(pass);
      }
    }
  }

  syncSurface(width: number, height: number) {
    const key = `${width}x${height}`;
    if (key !== this.surfaceKey) {
      this.surfaceKey = key;
      this.releaseTargets();
    }
  }

  prepare(steps: EffectChainStep[]): PreparedEffectStep[] {
    const prepared: PreparedEffectStep[] = [];
    for (const step of steps) {
      // A pass at its neutral settings changes nothing, so it costs nothing.
      if (step.pass.isIdentity?.(step.parameters)) {
        continue;
      }
      const compiled = this.getCompiledPass(step.pass);
      if (compiled) {
        prepared.push({ compiled, parameters: step.parameters });
      }
    }

    return prepared;
  }

  // Offscreen surface the whole composition renders into when the group stack
  // has effects of its own.
  getSceneTarget(width: number, height: number) {
    if (
      !this.sceneTarget ||
      this.sceneTarget.width !== width ||
      this.sceneTarget.height !== height
    ) {
      if (this.sceneTarget) {
        this.deleteTarget(this.sceneTarget);
      }
      this.sceneTarget = this.createTarget(width, height);
    }

    return this.sceneTarget;
  }

  // Surface a layer is framed into before its own effects run, in its
  // `width` × `height` corner. It is kept apart from the ping-pong targets
  // so the chain can read it while writing.
  getLayerTarget(width: number, height: number) {
    const [target] = this.getPooledTargets(this.layerTargets, width, height, 1);
    return {
      framebuffer: target.framebuffer,
      region: targetRegion(target, width, height),
    };
  }

  // Surface an FX clip with an Order arranges the layers beneath it into, in
  // its `width` × `height` corner, from a pool per nesting `depth`, since an
  // arrangement can hold another.
  getArrangementTarget(depth: number, width: number, height: number) {
    let pool = this.arrangementTargets.get(depth);
    if (!pool) {
      pool = new TargetPool(this.release);
      this.arrangementTargets.set(depth, pool);
    }
    const [target] = this.getPooledTargets(pool, width, height, 1);
    return {
      framebuffer: target.framebuffer,
      region: targetRegion(target, width, height),
    };
  }

  // Applies `steps` to the `width` × `height` picture in `source` in order.
  // Returns the region holding the result, or null when `output` is
  // "screen" and the last pass drew straight to the default framebuffer.
  // Leaves blending and scissoring disabled and the default framebuffer
  // bound; callers restore their own program state.
  run(
    source: TextureRegion,
    width: number,
    height: number,
    steps: PreparedEffectStep[],
    ctx: EffectContext,
    output: "texture" | "screen" = "texture",
  ) {
    const { gl } = this;
    if (!steps.length) {
      return source;
    }

    const targets = this.getPooledTargets(
      this.pingPongTargets,
      width,
      height,
      2,
    );
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(POSITION_ATTRIBUTE_LOCATION);
    gl.vertexAttribPointer(
      POSITION_ATTRIBUTE_LOCATION,
      2,
      gl.FLOAT,
      false,
      0,
      0,
    );
    gl.activeTexture(gl.TEXTURE0);
    const stepContext = this.stepContext;
    stepContext.time = ctx.time;
    stepContext.clipProgress = ctx.clipProgress;
    stepContext.resolution[0] = width;
    stepContext.resolution[1] = height;
    stepContext.bottomUp = ctx.bottomUp;

    let input = source;
    for (const [index, step] of steps.entries()) {
      const isLast = index === steps.length - 1;
      const target = isLast && output === "screen" ? null : targets[index % 2];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
      gl.viewport(0, 0, width, height);
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
      gl.useProgram(step.compiled.program);
      gl.bindTexture(gl.TEXTURE_2D, input.texture);
      gl.uniform1i(step.compiled.texture, 0);
      gl.uniform2f(step.compiled.uvScale, ...input.uvScale);
      gl.uniform2f(step.compiled.uvMax, ...input.uvMax);
      step.compiled.pass.setUniforms(
        gl,
        step.compiled.locations,
        step.parameters,
        stepContext,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (target) {
        input = targetRegion(target, width, height);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return output === "screen" ? null : input;
  }

  dispose() {
    this.releaseTargets();
    for (const compiled of this.programs.values()) {
      if (compiled) {
        this.gl.deleteProgram(compiled.program);
      }
    }
    this.programs.clear();
    for (const pending of this.pending.values()) {
      this.gl.deleteShader(pending.vertexShader);
      this.gl.deleteShader(pending.fragmentShader);
      this.gl.deleteProgram(pending.program);
    }
    this.pending.clear();
  }

  private getCompiledPass(pass: EffectPass) {
    if (this.programs.has(pass)) {
      return this.programs.get(pass) ?? null;
    }

    const { gl } = this;
    let compiled: CompiledPass | null = null;
    try {
      const pending = this.pending.get(pass) ?? this.startPass(pass);
      this.pending.delete(pass);
      const program = finishProgram(gl, pending);
      const locations: EffectUniformLocations = {};
      for (const name of pass.uniforms) {
        locations[name] = gl.getUniformLocation(program, name);
      }
      compiled = {
        pass,
        program,
        texture: gl.getUniformLocation(program, "uTex"),
        uvScale: gl.getUniformLocation(program, "uFxUvScale"),
        uvMax: gl.getUniformLocation(program, "uFxUvMax"),
        locations,
      };
    } catch (error) {
      this.failPass(pass, error);
      return null;
    }

    this.programs.set(pass, compiled);
    return compiled;
  }

  private startPass(pass: EffectPass) {
    return startProgram(
      this.gl,
      FULLSCREEN_VERTEX_SOURCE,
      FRAGMENT_HEADER +
        pass.fragmentSource.replace(/\btexture2D\s*\(/g, "fxTexture2D("),
    );
  }

  private failPass(pass: EffectPass, error: unknown) {
    console.warn(`Effect "${pass.effectName}" failed to compile.`, error);
    this.pending.delete(pass);
    this.programs.set(pass, null);
  }

  // `count` targets from `pool` with room for a `width` × `height` picture.
  private getPooledTargets(
    pool: TargetPool,
    width: number,
    height: number,
    count: number,
  ) {
    const bucket = this.exactTargets ? 1 : TARGET_SIZE_BUCKET;
    const bucketWidth = bucketTargetSize(width, this.maxTextureSize, bucket);
    const bucketHeight = bucketTargetSize(height, this.maxTextureSize, bucket);
    return pool.get(
      (target) =>
        this.exactTargets
          ? target.width === width && target.height === height
          : target.width >= width && target.height >= height,
      () =>
        Array.from({ length: count }, () =>
          this.createTarget(bucketWidth, bucketHeight),
        ),
    );
  }

  private createTarget(width: number, height: number): RenderTarget {
    const { gl } = this;
    renderStats.targetAllocations++;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      throw new Error("Failed to allocate WebGL effect framebuffer.");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`WebGL effect framebuffer is incomplete (${status}).`);
    }

    return { framebuffer, texture, width, height };
  }

  private deleteTarget(target: RenderTarget) {
    this.gl.deleteFramebuffer(target.framebuffer);
    this.gl.deleteTexture(target.texture);
  }

  private releaseTargets() {
    this.pingPongTargets.clear();
    this.layerTargets.clear();
    for (const pool of this.arrangementTargets.values()) {
      pool.clear();
    }
    this.arrangementTargets.clear();
    if (this.sceneTarget) {
      this.deleteTarget(this.sceneTarget);
      this.sceneTarget = null;
    }
  }
}
