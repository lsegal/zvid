import { smoothstep } from "../distort.ts";
import {
  mixRgba,
  scaleRgba,
  type TransitionTypeDefinition,
  type Vec2,
} from "../type.ts";

// How far along the diagonal the fold travels: past the far corner (√2),
// so the last of the flap is gone at the end.
const TRAVEL = 1.5;
// How much of the page's back shows its picture through the paper.
const SHOW_THROUGH = 0.25;
// How wide the shadow the fold casts on B is.
const SHADOW = 0.08;

// A peels up from its bottom-right corner, folding back over itself toward
// the top left, and reveals B beneath. The flap shows the page's pale back
// with A faintly through it, and the fold shadows B.
export const transitionType: TransitionTypeDefinition = {
  name: "Page Curl",
  menuOrder: 320,
  glsl: `
    vec2 diagonal = vec2(-0.70710678, 0.70710678);
    float fold = p * ${TRAVEL.toFixed(6)};
    float s = dot(uv - vec2(1.0, 0.0), diagonal);
    if (s < fold) {
      float shadow = 1.0 - smoothstep(0.0, ${SHADOW.toFixed(6)}, fold - s);
      return compB(uv) * (1.0 - 0.4 * shadow);
    }
    if (s < fold * 2.0) {
      vec4 page = compA(uv - diagonal * 2.0 * (s - fold));
      if (page.a > 0.0) {
        vec4 paper = vec4(vec3(0.92 * page.a), page.a);
        return mix(paper, page, ${SHOW_THROUGH.toFixed(6)});
      }
    }
    return compA(uv);
  `,
  render({ a, b }, uv, p) {
    const diagonal: Vec2 = [-Math.SQRT1_2, Math.SQRT1_2];
    const fold = p * TRAVEL;
    const s = (uv[0] - 1) * diagonal[0] + uv[1] * diagonal[1];
    if (s < fold) {
      const shadow = 1 - smoothstep(0, SHADOW, fold - s);
      return scaleRgba(b(uv), 1 - 0.4 * shadow);
    }
    if (s < fold * 2) {
      const reach = 2 * (s - fold);
      const page = a([
        uv[0] - diagonal[0] * reach,
        uv[1] - diagonal[1] * reach,
      ]);
      if (page[3] > 0) {
        const paper = [
          0.92 * page[3],
          0.92 * page[3],
          0.92 * page[3],
          page[3],
        ] as const;
        return mixRgba(paper, page, SHOW_THROUGH);
      }
    }
    return a(uv);
  },
};
