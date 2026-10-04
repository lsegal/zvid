import {
  over,
  shifted,
  TRANSPARENT,
  type TransitionTypeDefinition,
  type Vec2,
} from "../type.ts";

// A splits down the middle and its halves slide apart over B, out to the
// sides (Horizontal) or to the top and bottom (Vertical).
export const transitionType: TransitionTypeDefinition = {
  name: "Split",
  menuOrder: 190,
  options: ["orientation"],
  glsl: `
    vec2 axis = uVertical > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
    vec2 low = uv + axis * (0.5 * p);
    vec2 high = uv - axis * (0.5 * p);
    vec4 piece = dot(low, axis) < 0.5
      ? compA(low)
      : dot(high, axis) >= 0.5 ? compA(high) : vec4(0.0);
    return over(piece, compB(uv));
  `,
  render({ a, b, vertical }, uv, p) {
    const axis: Vec2 = vertical ? [0, 1] : [1, 0];
    const low = shifted(uv, axis, -0.5 * p);
    const high = shifted(uv, axis, 0.5 * p);
    const coordinate = (point: Vec2) => point[0] * axis[0] + point[1] * axis[1];
    const piece =
      coordinate(low) < 0.5
        ? a(low)
        : coordinate(high) >= 0.5
          ? a(high)
          : TRANSPARENT;
    return over(piece, b(uv));
  },
};
