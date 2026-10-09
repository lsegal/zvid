import { effectTextureUnit } from "../../../fx-shaders/effect-texture-units.ts";
import {
  type EffectPass,
  findEffectParameter,
} from "../../../fx-shaders/types.ts";
import { bindShapeMask, isShapeSvgReady } from "./custom-mask.ts";
import { SHAPE_EFFECT_NAME, SHAPE_KEY } from "./shape.ts";
import { custom, customShapeMediaPath } from "./shapes/custom.ts";
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
    uniform float uCustom;
    uniform sampler2D uMask;
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
      // The chain scales texture2D lookups to its pooled input's corner;
      // the mask is a texture of its own size, so it is read unscaled.
      float coverage = uCustom > 0.5
        ? texture2DProj(uMask, vec3(p, 1.0)).a
        : clamp(0.5 - d / max(length(slope), 1e-6), 0.0, 1.0);
      vec4 c = texture2D(uTex, vUv);
      gl_FragColor = vec4(c.rgb, c.a * coverage);
    }
  `,
  uniforms: ["uRes", "uShape", "uFlip", "uCustom", "uMask"],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform1f(
      loc.uShape,
      shapeIndex(findEffectParameter(params, SHAPE_KEY)?.value),
    );
    // Shapes are drawn top row first; a bottom-up picture is flipped.
    gl.uniform1f(loc.uFlip, ctx.bottomUp ? 1 : 0);
    // A Custom shape's SVG is drawn at the box's own size.
    const value = findEffectParameter(params, SHAPE_KEY)?.value;
    const unit = loc.uMask ? effectTextureUnit(loc.uMask) : -1;
    const masked =
      findShape(value) === custom &&
      unit >= 0 &&
      bindShapeMask(
        gl,
        customShapeMediaPath(value),
        ctx.resolution[0],
        ctx.resolution[1],
        unit,
      );
    gl.uniform1f(loc.uCustom, masked ? 1 : 0);
    gl.uniform1i(loc.uMask, masked ? unit : 0);
  },
  // A Rectangle fills the whole box, so it leaves the layer as it is.
  // So does a Custom one until its SVG has loaded.
  isIdentity(params) {
    const value = findEffectParameter(params, SHAPE_KEY)?.value;
    const shape = findShape(value);
    return (
      shape === rectangle ||
      (shape === custom && !isShapeSvgReady(customShapeMediaPath(value)))
    );
  },
};
