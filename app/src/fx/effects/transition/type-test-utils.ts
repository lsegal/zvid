// Helpers for the tests of the types in types/: draw a type off the GPU
// with comp A solid red and comp B solid blue. It is compiled with the app,
// which has no Node types, so it throws its own errors rather than using
// node:assert.
import {
  type Rgba,
  TRANSPARENT,
  type TransitionInput,
  type TransitionTypeDefinition,
  type Vec2,
} from "./type.ts";

export const RED: Rgba = [1, 0, 0, 1];
export const BLUE: Rgba = [0, 0, 1, 1];

function inside(uv: Vec2) {
  return uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1;
}

export function input(overrides: Partial<TransitionInput> = {}) {
  return {
    a: (uv: Vec2) => (inside(uv) ? RED : TRANSPARENT),
    b: (uv: Vec2) => (inside(uv) ? BLUE : TRANSPARENT),
    direction: [-1, 0],
    softness: 0,
    irisIn: false,
    vertical: false,
    count: 8,
    origin: [0.5, 0.5],
    resolution: [1080, 1920],
    ...overrides,
  } satisfies TransitionInput;
}

export function colorAt(
  type: TransitionTypeDefinition,
  uv: Vec2,
  p: number,
  overrides: Partial<TransitionInput> = {},
) {
  return type.render(input(overrides), uv, p);
}

export function assertColor(actual: Rgba, expected: Rgba, message?: string) {
  for (let channel = 0; channel < 4; channel++) {
    if (!(Math.abs(actual[channel] - expected[channel]) < 1e-6)) {
      throw new Error(
        `${message ?? "color"}: expected [${expected}], got [${actual}]`,
      );
    }
  }
}

export const CENTER: Vec2 = [0.5, 0.5];
export const CORNERS: readonly Vec2[] = [
  [0.01, 0.01],
  [0.99, 0.01],
  [0.01, 0.99],
  [0.99, 0.99],
];

// The checks every iris type passes: Out opens B from the center, In
// closes A into it, and both start all A and end all B.
export function assertIris(type: TransitionTypeDefinition) {
  for (const irisIn of [false, true]) {
    const mode = irisIn ? "In" : "Out";
    for (const uv of [CENTER, ...CORNERS]) {
      assertColor(colorAt(type, uv, 0, { irisIn }), RED, `${mode} start`);
      assertColor(colorAt(type, uv, 1, { irisIn }), BLUE, `${mode} end`);
    }
    for (const uv of CORNERS) {
      assertColor(
        colorAt(type, uv, 0.5, { irisIn }),
        irisIn ? BLUE : RED,
        `${mode} middle corner`,
      );
    }
    assertColor(
      colorAt(type, CENTER, 0.5, { irisIn }),
      irisIn ? RED : BLUE,
      `${mode} middle center`,
    );
  }
}
