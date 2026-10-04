// Draws a Transition: blends two comps, each drawn whole into its own
// target, by the type's shader (see type.ts). Each type's program is linked
// the first time it is drawn.
import type { TextureRegion } from "../../../fx-shaders/chain.ts";
import {
  FULLSCREEN_VERTEX_SOURCE,
  linkProgram,
  POSITION_ATTRIBUTE_LOCATION,
} from "../../../fx-shaders/gl.ts";
import { findTransitionType } from "./registry.ts";
import type { TransitionSettings } from "./transition.ts";
import type { TransitionTypeDefinition } from "./type.ts";

// The comps are drawn into framebuffers, so they are bottom row first and
// `uv` runs +y up, as the types expect. Each is read through the part of
// its pooled target it fills, and is transparent outside 0..1.
export function transitionFragmentSource(type: TransitionTypeDefinition) {
  return `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    uniform sampler2D uCompA;
    uniform sampler2D uCompB;
    uniform vec2 uCompAScale;
    uniform vec2 uCompAMax;
    uniform vec2 uCompBScale;
    uniform vec2 uCompBMax;
    uniform vec2 uDirection;
    uniform float uSoftness;
    uniform vec2 uResolution;
    uniform float uProgress;
    varying vec2 vUv;

    bool insidePicture(vec2 uv) {
      return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0;
    }

    vec4 compA(vec2 uv) {
      return insidePicture(uv)
        ? texture2D(uCompA, min(uv * uCompAScale, uCompAMax))
        : vec4(0.0);
    }

    vec4 compB(vec2 uv) {
      return insidePicture(uv)
        ? texture2D(uCompB, min(uv * uCompBScale, uCompBMax))
        : vec4(0.0);
    }

    vec4 over(vec4 top, vec4 bottom) {
      return top + bottom * (1.0 - top.a);
    }

    float transitionAlong(vec2 uv) {
      return dot(uv - 0.5, uDirection) + 0.5;
    }

    float transitionNoise(vec2 uv) {
      vec2 pixel = floor(uv * uResolution);
      return fract(sin(pixel.x * 12.9898 + pixel.y * 78.233) * 43758.5453);
    }

    vec4 transitionColor(vec2 uv, float p) {${type.glsl}}

    void main() {
      gl_FragColor = transitionColor(vUv, uProgress);
    }
  `;
}

const UNIFORMS = [
  "uCompA",
  "uCompB",
  "uCompAScale",
  "uCompAMax",
  "uCompBScale",
  "uCompBMax",
  "uDirection",
  "uSoftness",
  "uResolution",
  "uProgress",
] as const;

type TransitionProgram = {
  program: WebGLProgram;
  locations: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
};

export class TransitionRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly positionBuffer: WebGLBuffer;
  private programs = new Map<TransitionTypeDefinition, TransitionProgram>();

  constructor(gl: WebGLRenderingContext, positionBuffer: WebGLBuffer) {
    this.gl = gl;
    this.positionBuffer = positionBuffer;
  }

  // Draws `settings`' blend of `a` into `b` over the whole `width` ×
  // `height` `framebuffer`, bottom row first like the comps.
  draw(
    framebuffer: WebGLFramebuffer,
    width: number,
    height: number,
    a: TextureRegion,
    b: TextureRegion,
    settings: TransitionSettings,
  ) {
    const { gl } = this;
    const { program, locations } = this.programFor(
      findTransitionType(settings.type),
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGLRenderingContext.useProgram is not a React hook.
    gl.useProgram(program);
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
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, b.texture);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, a.texture);
    gl.uniform1i(locations.uCompA, 0);
    gl.uniform1i(locations.uCompB, 1);
    gl.uniform2f(locations.uCompAScale, ...a.uvScale);
    gl.uniform2f(locations.uCompAMax, ...a.uvMax);
    gl.uniform2f(locations.uCompBScale, ...b.uvScale);
    gl.uniform2f(locations.uCompBMax, ...b.uvMax);
    gl.uniform2f(locations.uDirection, ...settings.direction);
    gl.uniform1f(locations.uSoftness, settings.softness);
    gl.uniform2f(locations.uResolution, width, height);
    gl.uniform1f(locations.uProgress, settings.progress);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Comp B's target may be drawn into next; it is no longer read.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose() {
    for (const { program } of this.programs.values()) {
      this.gl.deleteProgram(program);
    }
    this.programs.clear();
  }

  private programFor(type: TransitionTypeDefinition) {
    let compiled = this.programs.get(type);
    if (!compiled) {
      const { gl } = this;
      const program = linkProgram(
        gl,
        FULLSCREEN_VERTEX_SOURCE,
        transitionFragmentSource(type),
      );
      const locations = Object.fromEntries(
        UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
      ) as TransitionProgram["locations"];
      compiled = { program, locations };
      this.programs.set(type, compiled);
    }
    return compiled;
  }
}
