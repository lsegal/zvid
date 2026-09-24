import {
  FULLSCREEN_VERTEX_SOURCE,
  linkProgram,
  POSITION_ATTRIBUTE_LOCATION,
} from "./gl.ts";
import type { EffectChainStep } from "./registry.ts";
import type {
  EffectContext,
  EffectParameter,
  EffectPass,
  EffectUniformLocations,
} from "./types.ts";

const FRAGMENT_HEADER = "precision mediump float;\n";

type CompiledPass = {
  pass: EffectPass;
  program: WebGLProgram;
  texture: WebGLUniformLocation | null;
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

// Runs a layer's effect passes by ping-ponging between two framebuffers. One
// instance belongs to one WebGL context: programs compile lazily on first use
// and render targets are reallocated whenever the canvas surface changes size.
export class EffectChainRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly positionBuffer: WebGLBuffer;
  // A null entry records a pass that failed to compile; it stays passthrough.
  private programs = new Map<EffectPass, CompiledPass | null>();
  private pingPongTargets = new Map<string, [RenderTarget, RenderTarget]>();
  private sceneTarget: RenderTarget | null = null;
  private surfaceKey = "";

  constructor(gl: WebGLRenderingContext, positionBuffer: WebGLBuffer) {
    this.gl = gl;
    this.positionBuffer = positionBuffer;
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

  // Applies `steps` to `source` in order. Returns the texture holding the
  // result, or null when `output` is "screen" and the last pass drew straight
  // to the default framebuffer. Leaves blending and scissoring disabled and
  // the default framebuffer bound; callers restore their own program state.
  run(
    source: WebGLTexture,
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

    const targets = this.getPingPongTargets(width, height);
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
      gl.viewport(0, 0, width, height);
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
      gl.useProgram(step.compiled.program);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.uniform1i(step.compiled.texture, 0);
      step.compiled.pass.setUniforms(
        gl,
        step.compiled.locations,
        step.parameters,
        { ...ctx, resolution: [width, height] },
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (target) {
        input = target.texture;
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
  }

  private getCompiledPass(pass: EffectPass) {
    if (this.programs.has(pass)) {
      return this.programs.get(pass) ?? null;
    }

    const { gl } = this;
    let compiled: CompiledPass | null = null;
    try {
      const program = linkProgram(
        gl,
        FULLSCREEN_VERTEX_SOURCE,
        FRAGMENT_HEADER + pass.fragmentSource,
      );
      const locations: EffectUniformLocations = {};
      for (const name of pass.uniforms) {
        locations[name] = gl.getUniformLocation(program, name);
      }
      compiled = {
        pass,
        program,
        texture: gl.getUniformLocation(program, "uTex"),
        locations,
      };
    } catch (error) {
      console.warn(`Effect "${pass.effectName}" failed to compile.`, error);
    }

    this.programs.set(pass, compiled);
    return compiled;
  }

  private getPingPongTargets(width: number, height: number) {
    const key = `${width}x${height}`;
    let targets = this.pingPongTargets.get(key);
    if (!targets) {
      targets = [
        this.createTarget(width, height),
        this.createTarget(width, height),
      ];
      this.pingPongTargets.set(key, targets);
    }

    return targets;
  }

  private createTarget(width: number, height: number): RenderTarget {
    const { gl } = this;
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
    for (const targets of this.pingPongTargets.values()) {
      for (const target of targets) {
        this.deleteTarget(target);
      }
    }
    this.pingPongTargets.clear();
    if (this.sceneTarget) {
      this.deleteTarget(this.sceneTarget);
      this.sceneTarget = null;
    }
  }
}
