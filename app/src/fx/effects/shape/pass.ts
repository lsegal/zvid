import {
  type EffectPass,
  findEffectParameter,
} from "../../../fx-shaders/types.ts";
import { SHAPE_EFFECT_NAME, SHAPE_KEY } from "./shape.ts";
import { findShape, SHAPES, shapeIndex } from "./shapes/index.ts";
import { rectangle } from "./shapes/rectangle.ts";

const shapeFunctions = SHAPES.map(
  (shape, index) => `float shape${index}(vec2 p) {${shape.glsl}}`,
).join("\n");

const shapeBranches = SHAPES.map((_, index) =>
  index < SHAPES.length - 1
    ? `if (uShape < ${index}.5) return shape${index}(p);`
    : `return shape${index}(p);`,
).join("\n      ");

// Clears the layer outside a shape stretched over its whole box, so the
// layer's Transform sizes, places and turns the shape. The edge is
// antialiased over one pixel, by the shape function's gradient in pixels.
export const pass: EffectPass = {
  effectName: SHAPE_EFFECT_NAME,
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uShape;
    uniform float uFlip;
    varying vec2 vUv;

    ${shapeFunctions}

    float shapeAt(vec2 p) {
      ${shapeBranches}
    }

    void main() {
      vec2 p = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlip));
      vec2 pixel = 1.0 / uRes;
      float d = shapeAt(p);
      vec2 slope = vec2(
        shapeAt(p + vec2(pixel.x, 0.0)) - d,
        shapeAt(p + vec2(0.0, pixel.y)) - d
      );
      float coverage = clamp(0.5 - d / max(length(slope), 1e-6), 0.0, 1.0);
      vec4 c = texture2D(uTex, vUv);
      gl_FragColor = vec4(c.rgb, c.a * coverage);
    }
  `,
  uniforms: ["uRes", "uShape", "uFlip"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform1f(
      loc.uShape,
      shapeIndex(findEffectParameter(params, SHAPE_KEY)?.value),
    );
    // Shapes are drawn top row first; a bottom-up picture is flipped.
    gl.uniform1f(loc.uFlip, ctx.bottomUp ? 1 : 0);
  },
  // A Rectangle fills the whole box, so it leaves the layer as it is.
  isIdentity(params) {
    return (
      findShape(findEffectParameter(params, SHAPE_KEY)?.value) === rectangle
    );
  },
};
