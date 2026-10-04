import { renderStats } from "../render-stats.ts";
import {
  FULLSCREEN_VERTEX_SOURCE,
  linkProgram,
  POSITION_ATTRIBUTE_LOCATION,
} from "./gl.ts";
import type { EffectChainStep } from "./registry.ts";
import {
  type EffectContext,
  type EffectParameter,
  type EffectPass,
  type EffectStage,
  type EffectUniformLocations,
  stageSize,
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

// Added for a pass with stages: their pooled targets hold their pictures in
// the corner as well, all at one size, so they share one mapping.
const STAGE_HEADER = `uniform vec2 uFxStageUvScale;
uniform vec2 uFxStageUvMax;
vec4 fxStageTexture2D(sampler2D tex, vec2 uv) {
  return texture2D(tex, min(uv * uFxStageUvScale, uFxStageUvMax));
}
`;

// Pooled targets are allocated with sides rounded up to a multiple of this,
// so a slot whose size animates reuses a few targets rather than
// allocating new ones every frame.
export const TARGET_SIZE_BUCKET = 64;

// Pooled sets of targets kept for reuse; the least recently used is freed
// past this.
export const MAX_POOLED_TARGETS = 8;

type CompiledProgram = {
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
  uvScale: WebGLUniformLocation | null;
  uvMax: WebGLUniformLocation | null;
  // The samplers of the pass's stages, in order; null where unused.
  stageTextures: Array<WebGLUniformLocation | null>;
  stageUvScale: WebGLUniformLocation | null;
  stageUvMax: WebGLUniformLocation | null;
  locations: EffectUniformLocations;
};

type CompiledStage = CompiledProgram & { stage: EffectStage };

type CompiledPass = CompiledProgram & {
  pass: EffectPass;
  stages: CompiledStage[];
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

  get(fits: (set: RenderTarget[]) => boolean, create: () => RenderTarget[]) {
    const area = (set: RenderTarget[]) => set[0].width * set[0].height;
    let best = -1;
    for (const [index, set] of this.sets.entries()) {
      if (fits(set) && (best < 0 || area(set) < area(this.sets[best]))) {
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
// instance belongs to one WebGL context: programs compile lazily on first use
// and render targets are reallocated whenever the canvas surface changes size.
// Layer, ping-pong and stage targets come from bounded pools of bucketed
// sizes, a picture drawn into the corner of one (see `targetRegion`). A pass
// with stages draws them into their own targets just before it runs.
export class EffectChainRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly positionBuffer: WebGLBuffer;
  // A null entry records a pass that failed to compile; it stays passthrough.
  private programs = new Map<EffectPass, CompiledPass | null>();
  private pingPongTargets: TargetPool;
  private stageTargets: TargetPool;
  private sceneTarget: RenderTarget | null = null;
  private layerTargets: TargetPool;
  private arrangementTargets = new Map<number, RenderTarget>();
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
    const release = (targets: RenderTarget[]) => {
      for (const target of targets) {
        this.deleteTarget(target);
      }
    };
    this.pingPongTargets = new TargetPool(release);
    this.stageTargets = new TargetPool(release);
    this.layerTargets = new TargetPool(release);
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

  // Surface an FX clip with an Order arranges the layers beneath it into, one
  // per nesting `depth`, since an arrangement can hold another.
  getArrangementTarget(depth: number, width: number, height: number) {
    let target = this.arrangementTargets.get(depth);
    if (!target || target.width !== width || target.height !== height) {
      if (target) {
        this.deleteTarget(target);
      }
      target = this.createTarget(width, height);
      this.arrangementTargets.set(depth, target);
    }

    return target;
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

    let input = source;
    for (const [index, step] of steps.entries()) {
      const isLast = index === steps.length - 1;
      const target = isLast && output === "screen" ? null : targets[index % 2];
      const { compiled, parameters } = step;
      const stepCtx: EffectContext = { ...ctx, resolution: [width, height] };
      const stages = this.runStages(input, compiled, parameters, stepCtx);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
      gl.viewport(0, 0, width, height);
      this.bindProgram(compiled, input, stages);
      compiled.pass.setUniforms(gl, compiled.locations, parameters, stepCtx);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (stages) {
        this.unbindStages(stages.targets.length);
      }
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
        for (const stage of compiled.stages) {
          this.gl.deleteProgram(stage.program);
        }
      }
    }
    this.programs.clear();
  }

  // Draws `compiled`'s stages from `input` into pooled stage targets and
  // returns them, or null when the pass has none or its scale skips them.
  private runStages(
    input: TextureRegion,
    compiled: CompiledPass,
    parameters: EffectParameter[],
    ctx: EffectContext,
  ) {
    const scale = compiled.stages.length
      ? (compiled.pass.stageScale?.(parameters, ctx) ?? 0)
      : 0;
    if (!(scale > 0)) {
      return null;
    }

    const { gl } = this;
    const [width, height] = ctx.resolution;
    const stageWidth = stageSize(width, scale);
    const stageHeight = stageSize(height, scale);
    const targets = this.getPooledTargets(
      this.stageTargets,
      stageWidth,
      stageHeight,
      compiled.stages.length,
    );
    const stageCtx: EffectContext = {
      ...ctx,
      resolution: [stageWidth, stageHeight],
    };
    for (const [index, stage] of compiled.stages.entries()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[index].framebuffer);
      gl.viewport(0, 0, stageWidth, stageHeight);
      const earlier = targets.slice(0, index);
      this.bindProgram(stage, input, {
        targets: earlier,
        region: targetRegion(targets[0], stageWidth, stageHeight),
      });
      stage.stage.setUniforms(gl, stage.locations, parameters, stageCtx);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.unbindStages(earlier.length);
    }

    return {
      targets,
      region: targetRegion(targets[0], stageWidth, stageHeight),
    };
  }

  // Uses `compiled`'s program with `input` on texture unit 0 and `stages`'
  // pictures on the units after it.
  private bindProgram(
    compiled: CompiledProgram,
    input: TextureRegion,
    stages: { targets: RenderTarget[]; region: TextureRegion } | null,
  ) {
    const { gl } = this;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
    gl.useProgram(compiled.program);
    gl.bindTexture(gl.TEXTURE_2D, input.texture);
    gl.uniform1i(compiled.texture, 0);
    gl.uniform2f(compiled.uvScale, ...input.uvScale);
    gl.uniform2f(compiled.uvMax, ...input.uvMax);
    if (!stages) {
      return;
    }
    for (const [index, location] of compiled.stageTextures.entries()) {
      gl.activeTexture(gl.TEXTURE1 + index);
      gl.bindTexture(gl.TEXTURE_2D, stages.targets[index]?.texture ?? null);
      gl.uniform1i(location, 1 + index);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(compiled.stageUvScale, ...stages.region.uvScale);
    gl.uniform2f(compiled.stageUvMax, ...stages.region.uvMax);
  }

  // Unbinds the stage pictures from the units after unit 0, so no later
  // draw into one of their targets forms a feedback loop.
  private unbindStages(count: number) {
    const { gl } = this;
    for (let index = 0; index < count; index++) {
      gl.activeTexture(gl.TEXTURE1 + index);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  private getCompiledPass(pass: EffectPass) {
    if (this.programs.has(pass)) {
      return this.programs.get(pass) ?? null;
    }

    let compiled: CompiledPass | null = null;
    const programs: WebGLProgram[] = [];
    try {
      const stageNames = (pass.stages ?? []).map((stage) => stage.name);
      const stages = (pass.stages ?? []).map((stage, index) => {
        const program = this.compileProgram(
          stage.fragmentSource,
          stage.uniforms,
          stageNames.slice(0, index),
        );
        programs.push(program.program);
        return { ...program, stage };
      });
      const main = this.compileProgram(
        pass.fragmentSource,
        pass.uniforms,
        stageNames,
      );
      compiled = { ...main, pass, stages };
    } catch (error) {
      for (const program of programs) {
        this.gl.deleteProgram(program);
      }
      console.warn(`Effect "${pass.effectName}" failed to compile.`, error);
    }

    this.programs.set(pass, compiled);
    return compiled;
  }

  // Links a fragment shader body that reads the pass's input through `uTex`
  // and the pictures of the stages named `stageNames` through their own
  // samplers.
  private compileProgram(
    fragmentSource: string,
    uniforms: string[],
    stageNames: string[],
  ): CompiledProgram {
    const { gl } = this;
    let source = fragmentSource;
    for (const name of stageNames) {
      source = source.replace(
        new RegExp(`\\btexture2D\\s*\\(\\s*${name}\\b`, "g"),
        `fxStageTexture2D(${name}`,
      );
    }
    source = source.replace(/\btexture2D\s*\(/g, "fxTexture2D(");
    const program = linkProgram(
      gl,
      FULLSCREEN_VERTEX_SOURCE,
      FRAGMENT_HEADER + (stageNames.length ? STAGE_HEADER : "") + source,
    );
    const locations: EffectUniformLocations = {};
    for (const name of uniforms) {
      locations[name] = gl.getUniformLocation(program, name);
    }
    return {
      program,
      texture: gl.getUniformLocation(program, "uTex"),
      uvScale: gl.getUniformLocation(program, "uFxUvScale"),
      uvMax: gl.getUniformLocation(program, "uFxUvMax"),
      stageTextures: stageNames.map((name) =>
        gl.getUniformLocation(program, name),
      ),
      stageUvScale: gl.getUniformLocation(program, "uFxStageUvScale"),
      stageUvMax: gl.getUniformLocation(program, "uFxStageUvMax"),
      locations,
    };
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
      ([target, ...rest]) =>
        rest.length + 1 >= count &&
        (this.exactTargets
          ? target.width === width && target.height === height
          : target.width >= width && target.height >= height),
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
    this.stageTargets.clear();
    this.layerTargets.clear();
    for (const target of this.arrangementTargets.values()) {
      this.deleteTarget(target);
    }
    this.arrangementTargets.clear();
    if (this.sceneTarget) {
      this.deleteTarget(this.sceneTarget);
      this.sceneTarget = null;
    }
  }
}
