// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnimationDefaults } from "../../../fx-animation-defaults.ts";
import {
  FX_EFFECT_DEFINITIONS,
  getEffectDefinition,
} from "../../../fx-registry.ts";
import type { EffectContext } from "../../../fx-shaders/types.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { ALL_SCOPES } from "../../types.ts";
import {
  MOTION_BLUR_MAX_DISTANCE,
  pass,
  type SmearStage,
  smearStages,
} from "./pass.ts";

const stages = pass.stages ?? [];

type Rgba = [number, number, number, number];
type Picture = Rgba[][];

const SIZE = 61;

// A SIZE×SIZE picture, one pixel in pixels of the output at 1080p, so a
// Distance is that many of its pixels.
const SQUARE: EffectContext = {
  ...CONTEXT,
  resolution: [SIZE, SIZE],
  pixelScale: 1,
};

// A bilinear read of `picture` at (`x`, `y`), in texels from the first
// one's center, clamped to its edges as the chain clamps every read.
function read(picture: Picture, x: number, y: number): Rgba {
  const clamp = (value: number) => Math.min(Math.max(value, 0), SIZE - 1);
  const [cx, cy] = [clamp(x), clamp(y)];
  const [left, top] = [Math.floor(cx), Math.floor(cy)];
  const [right, bottom] = [
    Math.min(left + 1, SIZE - 1),
    Math.min(top + 1, SIZE - 1),
  ];
  const [tx, ty] = [cx - left, cy - top];
  return [0, 1, 2, 3].map(
    (channel) =>
      (picture[top][left][channel] * (1 - tx) +
        picture[top][right][channel] * tx) *
        (1 - ty) +
      (picture[bottom][left][channel] * (1 - tx) +
        picture[bottom][right][channel] * tx) *
        ty,
  ) as Rgba;
}

// One stage of the smear as its shader draws it: the average of `taps`
// reads centered on each pixel, `step` apart in texture coordinates. Row 0
// is the top, as on a layer texture.
function smearStage(picture: Picture, { step, taps }: SmearStage): Picture {
  const [dx, dy] = [step[0] * SIZE, step[1] * SIZE];
  return picture.map((row, y) =>
    row.map((_, x) => {
      const sum: Rgba = [0, 0, 0, 0];
      for (let tap = 0; tap < taps; tap++) {
        const offset = tap - (taps - 1) / 2;
        const texel = read(picture, x + offset * dx, y + offset * dy);
        for (let channel = 0; channel < 4; channel++) {
          sum[channel] += texel[channel] / taps;
        }
      }
      return sum;
    }),
  );
}

// `picture` smeared as the pass draws it: premultiplied, through both
// stages, and divided by alpha again.
function smear(picture: Picture, values: Record<string, number>) {
  const { fine, comb } = smearStages(params(values), SQUARE);
  const premultiplied = picture.map((row) =>
    row.map(([r, g, b, a]) => [r * a, g * a, b * a, a] as Rgba),
  );
  return smearStage(smearStage(premultiplied, fine), comb).map((row) =>
    row.map(
      ([r, g, b, a]) =>
        (a > 0 ? [r / a, g / a, b / a, a] : [0, 0, 0, 0]) as Rgba,
    ),
  );
}

function picture(paint: (x: number, y: number) => Rgba): Picture {
  return Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => paint(x, y)),
  );
}

const MIDDLE = (SIZE - 1) / 2;
const DOT = picture((x, y) =>
  x === MIDDLE && y === MIDDLE ? [1, 1, 1, 1] : [0, 0, 0, 1],
);
const red = (smeared: Picture, x: number, y: number) => smeared[y][x][0];

describe("Motion Blur pass", () => {
  it("has Angle and Distance knobs", () => {
    const definition = getEffectDefinition("MotionBlur");
    assert.equal(definition.displayName, "Motion Blur");
    assert.deepEqual(definition.scopes, ALL_SCOPES);
    const [angle, distance] = definition.parameters;
    assert.equal(definition.parameters.length, 2);
    assert.equal(angle.key, "_Angle");
    assert.equal(angle.kind === "number" && angle.min, 0);
    assert.equal(angle.kind === "number" && angle.max, 180);
    assert.equal(angle.kind === "number" && angle.format(90), "90°");
    assert.equal(distance.key, "_Distance");
    assert.equal(distance.kind === "number" && distance.min, 0);
    assert.equal(distance.kind === "number" && distance.max, 400);
    assert.equal(distance.kind === "number" && distance.format(42), "42 px");
    assert.equal(MOTION_BLUR_MAX_DISTANCE, 400);
  });

  it("sits beside Gaussian Blur in the add menus", () => {
    const names = FX_EFFECT_DEFINITIONS.map(
      (definition) => definition.effectName,
    );
    assert.equal(
      names.indexOf("MotionBlur"),
      names.indexOf("GaussianBlur") + 1,
    );
  });

  it("is the identity at Distance 0", () => {
    assert.equal(pass.isIdentity?.(params({ _Distance: 0 })), true);
    assert.equal(pass.isIdentity?.(params({ _Distance: -5 })), true);
    assert.equal(pass.isIdentity?.(params({ _Distance: 0.5 })), false);
    assert.equal(pass.stageScale?.(params({ _Distance: 0 }), CONTEXT), 0);
    // With no length the main shader passes the picture through without
    // reading the skipped stages.
    assert.deepEqual(uniformValues(pass, params({ _Distance: 0 })), {
      uLength: [0],
    });
    assert.match(
      pass.fragmentSource,
      /if \(uLength <= 0\.0\) \{\s*gl_FragColor = texture2D\(uTex, vUv\);\s*return;\s*\}/,
    );
  });

  it("draws its stages at full size, so nothing blurs across the smear", () => {
    for (const distance of [1, 60, MOTION_BLUR_MAX_DISTANCE]) {
      assert.equal(
        pass.stageScale?.(params({ _Distance: distance }), CONTEXT),
        1,
      );
    }
  });

  it("is deterministic, reading neither time nor randomness", () => {
    for (const source of [pass, ...stages].map((s) => s.fragmentSource)) {
      assert.doesNotMatch(source, /uTime|random/i);
    }
    const parameters = params({ _Angle: 30, _Distance: 80 });
    for (const shader of [pass, ...stages]) {
      assert.deepEqual(
        uniformValues(shader, parameters),
        uniformValues(shader, parameters, {
          ...CONTEXT,
          time: 9,
          clipProgress: 0.9,
        }),
      );
    }
  });

  it("premultiplies, smears finely then along the length, and divides by alpha", () => {
    assert.deepEqual(
      stages.map((stage) => stage.name),
      ["uSmearFine", "uSmear"],
    );
    assert.match(stages[0].fragmentSource, /texture2D\(uTex, /);
    assert.match(stages[0].fragmentSource, /vec4\(c\.rgb \* c\.a, c\.a\)/);
    assert.match(stages[1].fragmentSource, /texture2D\(uSmearFine, /);
    assert.match(pass.fragmentSource, /texture2D\(uSmear, vUv\)/);
    assert.match(pass.fragmentSource, /smeared\.rgb \/ smeared\.a/);
  });

  it("steps along the Angle: 0° across, 90° up the screen", () => {
    const comb = (values: Record<string, number>, ctx = SQUARE) =>
      smearStages(params(values), ctx).comb.step;
    const pixel = 1 / SIZE;
    const [x0, y0] = comb({ _Angle: 0, _Distance: 32 });
    assert.equal(x0, pixel);
    assert.equal(Math.abs(y0), 0);
    const [x90, y90] = comb({ _Angle: 90, _Distance: 32 });
    assert.ok(Math.abs(x90) < 1e-12);
    // Up a top-down layer texture is toward row 0.
    assert.ok(Math.abs(y90 + pixel) < 1e-12);
    // A bottom-up framebuffer runs the other way, so 45° stays up and to
    // the right on screen.
    const [x45, y45] = comb({ _Angle: 45, _Distance: 32 });
    const [bx45, by45] = comb(
      { _Angle: 45, _Distance: 32 },
      { ...SQUARE, bottomUp: true },
    );
    assert.ok(x45 > 0 && y45 < 0);
    assert.equal(bx45, x45);
    assert.equal(by45, -y45);
  });

  it("steps its copies a whole pixel apart along the main axis", () => {
    const stagesAt = (values: Record<string, number>) =>
      smearStages(params(values), CONTEXT);
    const [width, height] = CONTEXT.resolution;
    // 32 pixels: 32 copies a pixel apart, each spread over the pixel by two
    // reads half a pixel apart.
    let { fine, comb } = stagesAt({ _Distance: 32 });
    assert.deepEqual(comb, { step: [1 / width, -0], taps: 32 });
    assert.deepEqual(fine, { step: [0.5 / width, -0], taps: 2 });
    // The longest: 31 copies 13 pixels apart, each spread by 26 reads.
    ({ fine, comb } = stagesAt({ _Distance: MOTION_BLUR_MAX_DISTANCE }));
    assert.equal(comb.step[0] * width, 13);
    assert.equal(comb.taps, 31);
    assert.equal(fine.taps, 26);
    assert.ok(Math.abs(fine.step[0] * width - 0.5) < 1e-12);
    // At 30° the copies are a pixel apart across, the main axis.
    ({ comb } = stagesAt({ _Angle: 30, _Distance: 20 }));
    assert.ok(Math.abs(comb.step[0] * width - 1) < 1e-12);
    assert.ok(Math.abs(-comb.step[1] * height - Math.tan(Math.PI / 6)) < 1e-12);
    assert.equal(comb.taps, Math.round(20 * Math.cos(Math.PI / 6)));
    // Under a pixel, one copy spreads the pixel over the Distance.
    ({ fine, comb } = stagesAt({ _Distance: 0.5 }));
    assert.equal(comb.taps, 1);
    assert.equal(fine.taps, 1);
  });

  it("scales its Distance with the output size", () => {
    // The smear's full length in pixels of the picture `ctx` describes.
    const pixels = (ctx: EffectContext) => {
      const { comb } = smearStages(params({ _Distance: 100 }), ctx);
      return comb.step[0] * ctx.resolution[0] * comb.taps;
    };
    const output = (width: number, height: number) => ({
      ...CONTEXT,
      resolution: [width, height] as [number, number],
    });
    // Within half a copy's step of the Distance.
    assert.ok(Math.abs(pixels(output(1920, 1080)) - 100) <= 1.5);
    assert.ok(Math.abs(pixels(output(3840, 2160)) - 200) <= 3);
    assert.ok(Math.abs(pixels(output(1080, 1920)) - 100) <= 1.5);
    // A picture smaller than the output, such as a layer in an Order slot,
    // is smeared by the output's pixels, not its own.
    assert.equal(
      pixels({ ...output(640, 360), pixelScale: 1 }),
      pixels(output(1920, 1080)),
    );
  });

  it("smears a bright dot into an even streak at 0°, and none down", () => {
    const smeared = smear(DOT, { _Angle: 0, _Distance: 20 });
    // The light is kept, all of it in the dot's row.
    let total = 0;
    for (let x = 0; x < SIZE; x++) {
      total += red(smeared, x, MIDDLE);
      assert.ok(red(smeared, x, MIDDLE - 1) < 1e-12);
      assert.ok(red(smeared, x, MIDDLE + 1) < 1e-12);
    }
    assert.ok(Math.abs(total - 1) < 1e-9);
    // Even across the Distance, centered on the dot, and gone past it.
    for (let distance = 0; distance < 8; distance++) {
      assert.ok(
        Math.abs(red(smeared, MIDDLE + distance, MIDDLE) - 0.05) < 2e-3,
      );
      assert.ok(
        Math.abs(red(smeared, MIDDLE - distance, MIDDLE) - 0.05) < 2e-3,
      );
    }
    assert.ok(red(smeared, MIDDLE + 12, MIDDLE) < 1e-12);
    assert.ok(red(smeared, MIDDLE - 12, MIDDLE) < 1e-12);
  });

  it("smears down at 90°, and none across", () => {
    const smeared = smear(DOT, { _Angle: 90, _Distance: 20 });
    for (let distance = 0; distance < 8; distance++) {
      assert.ok(
        Math.abs(red(smeared, MIDDLE, MIDDLE + distance) - 0.05) < 2e-3,
      );
      assert.ok(
        Math.abs(red(smeared, MIDDLE, MIDDLE - distance) - 0.05) < 2e-3,
      );
    }
    for (let y = 0; y < SIZE; y++) {
      assert.ok(red(smeared, MIDDLE - 1, y) < 1e-9);
      assert.ok(red(smeared, MIDDLE + 1, y) < 1e-9);
    }
  });

  it("smears evenly along a slanted Angle", () => {
    const smeared = smear(DOT, { _Angle: 30, _Distance: 20 });
    // Each column holds the same share of the light along the streak.
    const column = (x: number) =>
      smeared.reduce((sum, row) => sum + row[x][0], 0);
    const copies = Math.round(20 * Math.cos(Math.PI / 6));
    for (let distance = 0; distance < 7; distance++) {
      assert.ok(Math.abs(column(MIDDLE + distance) - 1 / copies) < 1e-9);
      assert.ok(Math.abs(column(MIDDLE - distance) - 1 / copies) < 1e-9);
    }
    // Rising to the right, along the line through the dot.
    for (let x = MIDDLE - 7; x <= MIDDLE + 7; x++) {
      const along = MIDDLE - (x - MIDDLE) * Math.tan(Math.PI / 6);
      const center =
        smeared.reduce((sum, row, y) => sum + y * row[x][0], 0) / column(x);
      assert.ok(Math.abs(center - along) < 0.5, `x = ${x}`);
    }
  });

  it("doesn't darken colors at the edge of transparent areas", () => {
    const half = picture((x) =>
      x < MIDDLE ? [1, 0.5, 0.25, 1] : [0, 0, 0, 0],
    );
    const smeared = smear(half, { _Angle: 0, _Distance: 12 });
    for (const [r, g, b, a] of smeared[MIDDLE]) {
      if (a > 1e-9) {
        assert.ok(Math.abs(r - 1) < 1e-9);
        assert.ok(Math.abs(g - 0.5) < 1e-9);
        assert.ok(Math.abs(b - 0.25) < 1e-9);
      }
    }
    // The edge fades out rather than stopping hard.
    const alpha = (x: number) => smeared[MIDDLE][x][3];
    assert.ok(alpha(MIDDLE - 2) < 1 && alpha(MIDDLE - 2) > 0.5);
    assert.ok(alpha(MIDDLE + 2) > 0 && alpha(MIDDLE + 2) < 0.5);
  });

  it("supports the Animation modifier's Clip, Reactive and LFO modes", () => {
    assert.deepEqual(getAnimationDefaults("MotionBlur")?.modes, [
      "clip",
      "reactive",
      "lfo",
    ]);
  });
});
