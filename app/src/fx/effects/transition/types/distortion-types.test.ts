import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findTransitionType, TRANSITION_TYPES } from "../registry.ts";
import { directionVector } from "../transition.ts";
import {
  mixRgba,
  type Rgba,
  type TransitionInput,
  type Vec2,
} from "../type.ts";

const RESOLUTION: Vec2 = [1080, 1920];

function inside(uv: Vec2) {
  return uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1;
}

// Two pictures that differ everywhere, so a sample shows which it came from.
const compA = (uv: Vec2): Rgba =>
  inside(uv) ? [uv[0], 0.2, 0.1, 1] : [0, 0, 0, 0];
const compB = (uv: Vec2): Rgba =>
  inside(uv) ? [0.1, uv[1], 0.9, 1] : [0, 0, 0, 0];

function input(
  direction = directionVector("Left"),
  softness = 0.2,
  a = compA,
): TransitionInput {
  return { a, b: compB, direction, softness, resolution: RESOLUTION };
}

function render(name: string, uv: Vec2, p: number, settings = input()) {
  const type = findTransitionType(name);
  assert.equal(type.name, name);
  return type.render(settings, uv, p);
}

function assertColor(actual: Rgba, expected: Rgba, message?: string) {
  for (let channel = 0; channel < 4; channel++) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) < 1e-6,
      `${message ?? ""} got [${actual}], expected [${expected}]`,
    );
  }
}

const NAMES = [
  "Flip",
  "Cube",
  "Page Curl",
  "Twirl",
  "Ripple",
  "Zoom Blur",
  "Spin",
  "Morph",
  "Pixelate",
  "Glitch",
  "Dip to White",
  "Burn",
];

// Pixel centers, so Pixelate's one-pixel blocks sample them unchanged.
const SAMPLES: Vec2[] = [
  [0.5 / 1080, 0.5 / 1920],
  [270.5 / 1080, 1500.5 / 1920],
  [540.5 / 1080, 960.5 / 1920],
  [1079.5 / 1080, 1919.5 / 1920],
];

describe("3D and distortion Transition types", () => {
  it("are all in the Type menu, in their order", () => {
    const names = TRANSITION_TYPES.map((type) => type.name);
    const positions = NAMES.map((name) => names.indexOf(name));
    assert.ok(
      positions.every((position) => position >= 0),
      `${names}`,
    );
    assert.deepEqual(
      positions,
      [...positions].sort((left, right) => left - right),
    );
  });

  for (const name of NAMES) {
    it(`${name} shows A at the start and B at the end`, () => {
      for (const direction of ["Left", "Right", "Up", "Down"] as const) {
        const settings = input(directionVector(direction));
        for (const uv of SAMPLES) {
          assertColor(
            render(name, uv, 0, settings),
            compA(uv),
            `${name} ${direction} 0`,
          );
          assertColor(
            render(name, uv, 1, settings),
            compB(uv),
            `${name} ${direction} 1`,
          );
        }
      }
    });
  }

  it("Flip is edge-on halfway, A turning before it and B after", () => {
    for (const uv of SAMPLES) {
      assertColor(render("Flip", uv, 0.5), [0, 0, 0, 0]);
    }
    const center: Vec2 = [0.5, 0.5];
    const shade = 0.6 + 0.4 * Math.cos(Math.PI / 4);
    assertColor(
      render("Flip", center, 0.25),
      compA(center).map((value) => value * shade) as unknown as Rgba,
    );
    assertColor(
      render("Flip", center, 0.75),
      compB(center).map((value) => value * shade) as unknown as Rgba,
    );
    // Turned edge-on enough, the card no longer reaches the picture's sides.
    assertColor(render("Flip", [0.02, 0.5], 0.4), [0, 0, 0, 0]);
    // A vertical flip narrows it top to bottom instead.
    const up = input(directionVector("Up"));
    assert.ok(render("Flip", [0.02, 0.5], 0.4, up)[3] > 0);
    assertColor(render("Flip", [0.5, 0.02], 0.4, up), [0, 0, 0, 0]);
  });

  it("Cube shows A rolling off in the Direction and B rolling in halfway", () => {
    const right = input(directionVector("Right"));
    const shade = 0.6 + 0.4 * Math.SQRT1_2;
    const onA = render("Cube", [0.7, 0.5], 0.5, right);
    const onB = render("Cube", [0.3, 0.5], 0.5, right);
    assert.ok(onA[2] < 0.1 * shade + 1e-6, `A is on the right: ${onA}`);
    assert.ok(onB[2] > 0.85 * shade, `B is on the left: ${onB}`);
    const left = input(directionVector("Left"));
    assert.ok(render("Cube", [0.7, 0.5], 0.5, left)[2] > 0.85 * shade);
  });

  it("Page Curl shows B by the corner and the page's back on the flap halfway", () => {
    const corner = render("Page Curl", [0.95, 0.05], 0.5);
    assertColor(corner, compB([0.95, 0.05]));
    const flap = render("Page Curl", [0.1, 0.9], 0.5);
    // The flap point is folded back from where the diagonal mirrors it.
    const s = (1 - 0.1 + 0.9) * Math.SQRT1_2;
    const reach = 2 * (s - 0.75);
    const page = compA([
      0.1 + Math.SQRT1_2 * reach,
      0.9 - Math.SQRT1_2 * reach,
    ]);
    assertColor(flap, mixRgba([0.92, 0.92, 0.92, 1], page, 0.25));
  });

  it("Twirl blends both through the vortex halfway", () => {
    const center: Vec2 = [0.5, 0.5];
    assertColor(
      render("Twirl", center, 0.5),
      mixRgba(compA(center), compB(center), 0.5),
    );
    const off: Vec2 = [0.6, 0.6];
    const plain = mixRgba(compA(off), compB(off), 0.5);
    assert.notDeepEqual(render("Twirl", off, 0.5), plain);
  });

  it("Ripple displaces the picture halfway", () => {
    const uv: Vec2 = [0.6, 0.55];
    const plain = mixRgba(compA(uv), compB(uv), 0.5);
    const rippled = render("Ripple", uv, 0.5);
    assert.ok(Math.abs(rippled[1] - plain[1]) > 1e-4);
    assert.equal(rippled[3], 1);
  });

  it("Zoom Blur cuts to a blurred B halfway", () => {
    assertColor(render("Zoom Blur", [0.5, 0.5], 0.5), compB([0.5, 0.5]));
    const blurred = render("Zoom Blur", [0.5, 0.9], 0.5);
    assert.ok(blurred[1] < 0.89 && blurred[1] > 0.76, `${blurred}`);
    assert.ok(Math.abs(blurred[2] - 0.9) < 1e-9);
  });

  it("Spin shows A turning out over B turning in halfway", () => {
    const center: Vec2 = [0.5, 0.5];
    const a = compA(center).map((value) => value * 0.5) as unknown as Rgba;
    const b = compB(center).map(
      (value) => value * 0.5 * 0.5,
    ) as unknown as Rgba;
    assertColor(render("Spin", center, 0.5), [
      a[0] + b[0],
      a[1] + b[1],
      a[2] + b[2],
      a[3] + b[3],
    ]);
    // At half size, the corners are outside both pictures.
    assertColor(render("Spin", [0.02, 0.02], 0.5), [0, 0, 0, 0]);
  });

  it("Morph crossfades the two, each warped, halfway", () => {
    const uv: Vec2 = [0.3, 0.7];
    const morphed = render("Morph", uv, 0.5);
    const plain = mixRgba(compA(uv), compB(uv), 0.5);
    assert.ok(Math.abs(morphed[0] - plain[0]) > 1e-4);
    assert.equal(morphed[2], plain[2]);
  });

  it("Pixelate is in its largest blocks halfway", () => {
    // An eighth of the short edge: 135 pixels.
    const block: Vec2 = [135 / 1080, 135 / 1920];
    const first = render("Pixelate", [0.01, 0.01], 0.5);
    assertColor(
      render("Pixelate", [block[0] - 0.001, block[1] - 0.001], 0.5),
      first,
    );
    const center: Vec2 = [block[0] / 2, block[1] / 2];
    assertColor(first, mixRgba(compA(center), compB(center), 0.5));
    assert.notDeepEqual(
      render("Pixelate", [block[0] + 0.001, 0.01], 0.5),
      first,
    );
  });

  it("Glitch cuts some bands to B halfway and splits the colors", () => {
    let fromB = 0;
    for (let band = 0; band < 24; band++) {
      const color = render("Glitch", [0.5, (band + 0.5) / 24], 0.5);
      if (color[2] > 0.5) {
        fromB++;
      }
    }
    assert.ok(fromB > 0 && fromB < 24, `${fromB} of 24 bands cut to B`);
    // Red comes from further right than the rest on A.
    const settings = input();
    const color = render("Glitch", [0.5, 0.01], 0.4, settings);
    assert.ok(Math.abs(color[0] - 0.5) > 1e-3);
  });

  it("Dip to White is white halfway", () => {
    for (const uv of SAMPLES) {
      assertColor(render("Dip to White", uv, 0.5), [1, 1, 1, 1]);
    }
  });

  it("Burn burns A's brightest parts through to B first", () => {
    const gray = (uv: Vec2): Rgba => [uv[0], uv[0], uv[0], 1];
    const hard = input(directionVector("Left"), 0, gray);
    assertColor(render("Burn", [0.8, 0.5], 0.5, hard), compB([0.8, 0.5]));
    assertColor(render("Burn", [0.2, 0.5], 0.5, hard), gray([0.2, 0.5]));
    // A soft edge glows where it is half burnt.
    const soft = input(directionVector("Left"), 1, gray);
    const edge = render("Burn", [0.5, 0.5], 0.5, soft);
    const plain = mixRgba(gray([0.5, 0.5]), compB([0.5, 0.5]), 0.5);
    assert.ok(edge[0] > plain[0], `${edge}`);
  });
});
