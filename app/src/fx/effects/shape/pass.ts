import { effectTextureUnit } from "../../../fx-shaders/effect-texture-units.ts";
import {
  type EffectParameter,
  type EffectPass,
  effectPixelScale,
  findEffectParameter,
  readEffectNumber,
} from "../../../fx-shaders/types.ts";
import { bindShapeMask, isShapeSvgReady } from "./custom-mask.ts";
import {
  DASH_KEY,
  DRAWN_KEY,
  GAP_KEY,
  OFFSET_KEY,
  SHAPE_EFFECT_NAME,
  SHAPE_KEY,
  STROKE_KEY,
} from "./shape.ts";
import { custom, customShapeMediaPath } from "./shapes/custom.ts";
import { findShape, SHAPES, shapeIndex } from "./shapes/index.ts";
import { OUTLINE_GLSL } from "./shapes/outline.ts";
import { rectangle } from "./shapes/rectangle.ts";

const shapeFunctions = SHAPES.map(
  (shape, index) => `float shape${index}(vec2 p) {${shape.glsl}}`,
).join("\n");

// A shape without an outline, such as Custom, is never outlined.
const outlineFunctions = SHAPES.map(
  (shape, index) =>
    `vec2 shapeOutline${index}(vec2 p, vec2 size) {${shape.outline?.glsl ?? "return vec2(0.0);"}}`,
).join("\n");

function branches(call: (index: number) => string) {
  return SHAPES.map((_, index) =>
    index < SHAPES.length - 1
      ? `if (uShape < ${index}.5) return ${call(index)};`
      : `return ${call(index)};`,
  ).join("\n      ");
}

// The outline's width, dash and gap in pixels as the shape is shown, and
// how much of it is drawn; a width of 0 fills the shape.
function outlineOf(params: EffectParameter[]) {
  const shape = findShape(findEffectParameter(params, SHAPE_KEY)?.value);
  const width = shape.outline
    ? Math.max(0, readEffectNumber(params, STROKE_KEY, 0))
    : 0;
  return {
    width,
    dash: Math.max(0, readEffectNumber(params, DASH_KEY, 0)),
    gap: Math.max(0, readEffectNumber(params, GAP_KEY, 20)),
    offset: readEffectNumber(params, OFFSET_KEY, 0),
    drawn: Math.max(0, Math.min(1, readEffectNumber(params, DRAWN_KEY, 1))),
  };
}

// Clears the layer outside a shape stretched over its whole box, so the
// layer's Transform sizes, places and turns the shape. The edge is
// antialiased over one pixel, by the shape function's gradient in pixels.
// With a Stroke, only a band that wide inside the edge is kept, measured in
// pixels as the shape is shown so the band is even on a stretched box, and
// dashed along the edge's length.
export const pass: EffectPass = {
  effectName: SHAPE_EFFECT_NAME,
  fragmentSource: `
    uniform sampler2D uTex;
    uniform vec2 uRes;
    uniform float uShape;
    uniform float uFlip;
    uniform float uCustom;
    uniform sampler2D uMask;
    uniform vec2 uDisplay;
    uniform float uStroke;
    uniform vec3 uDash;
    uniform float uDrawn;
    varying vec2 vUv;

    ${shapeFunctions}
    ${OUTLINE_GLSL}
    ${outlineFunctions}

    float shapeAt(vec2 p) {
      ${branches((index) => `shape${index}(p)`)}
    }

    vec2 outlineAt(vec2 p, vec2 size) {
      ${branches((index) => `shapeOutline${index}(p, size)`)}
    }

    // How much of the outline covers p, whose edge distance is d with
    // gradient slope per pixel of the picture.
    float outlineCoverage(vec2 p, float d, vec2 slope) {
      // Distance to the edge in pixels as the shape is shown.
      float inside = -d / max(length(slope / uDisplay), 1e-6);
      float coverage =
        clamp(inside + 0.5, 0.0, 1.0) * clamp(uStroke - inside + 0.5, 0.0, 1.0);
      if (uDash.x <= 0.0 && uDrawn >= 1.0) {
        return coverage;
      }
      vec2 along = outlineAt(p, uRes * uDisplay);
      if (uDash.x > 0.0) {
        // Each dash starts a period along, its gap's halves on either side,
        // so both its ends are antialiased.
        float period = uDash.x + uDash.y;
        float m = mod(along.x - uDash.z + uDash.y * 0.5, period) - uDash.y * 0.5;
        coverage *= clamp(min(m, uDash.x - m) + 0.5, 0.0, 1.0);
      }
      if (uDrawn < 1.0) {
        coverage *= clamp(uDrawn * along.y - along.x, 0.0, 1.0);
      }
      return coverage;
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
        : uStroke > 0.0
          ? outlineCoverage(p, d, slope)
          : clamp(0.5 - d / max(length(slope), 1e-6), 0.0, 1.0);
      vec4 c = texture2D(uTex, vUv);
      gl_FragColor = vec4(c.rgb, c.a * coverage);
    }
  `,
  uniforms: [
    "uRes",
    "uShape",
    "uFlip",
    "uCustom",
    "uMask",
    "uDisplay",
    "uStroke",
    "uDash",
    "uDrawn",
  ],
  setUniforms(gl, loc, params, ctx) {
    gl.uniform2f(loc.uRes, ctx.resolution[0], ctx.resolution[1]);
    gl.uniform1f(
      loc.uShape,
      shapeIndex(findEffectParameter(params, SHAPE_KEY)?.value),
    );
    // Shapes are drawn top row first; a bottom-up picture is flipped.
    gl.uniform1f(loc.uFlip, ctx.bottomUp ? 1 : 0);
    const display = ctx.displayScale ?? [1, 1];
    gl.uniform2f(
      loc.uDisplay,
      Math.max(display[0], 1e-6),
      Math.max(display[1], 1e-6),
    );
    const outline = outlineOf(params);
    const scale = effectPixelScale(ctx);
    gl.uniform1f(loc.uStroke, outline.width * scale);
    gl.uniform3f(
      loc.uDash,
      outline.dash * scale,
      outline.gap * scale,
      outline.offset * scale,
    );
    gl.uniform1f(loc.uDrawn, outline.drawn);
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
  // A filled Rectangle fills the whole box, so it leaves the layer as it
  // is. So does a Custom one until its SVG has loaded.
  isIdentity(params) {
    const value = findEffectParameter(params, SHAPE_KEY)?.value;
    const shape = findShape(value);
    return (
      (shape === rectangle && outlineOf(params).width <= 0) ||
      (shape === custom && !isShapeSvgReady(customShapeMediaPath(value)))
    );
  },
};
