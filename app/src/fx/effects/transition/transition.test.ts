import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { definition } from "./definition.ts";
import {
  DEFAULT_TRANSITION_TYPE,
  findTransitionType,
  TRANSITION_TYPES,
  typesUsing,
} from "./registry.ts";
import { transitionFragmentSource } from "./renderer.ts";
import {
  parseTransitionDirection,
  parseTransitionSettings,
  transitionProgress,
} from "./transition.ts";

const LINEAR = { motionIn: "Linear", motionOut: "Linear" } as const;

describe("Transition progress", () => {
  it("spans the clip at Full", () => {
    const full = Number.POSITIVE_INFINITY;
    assert.equal(transitionProgress(LINEAR, full, 0, 2), 0);
    assert.equal(transitionProgress(LINEAR, full, 0.5, 2), 0.25);
    assert.equal(transitionProgress(LINEAR, full, 1, 2), 0.5);
    assert.equal(transitionProgress(LINEAR, full, 2, 2), 1);
  });

  it("takes its Timing, centered in the clip", () => {
    // One second in the middle of a four-second clip.
    assert.equal(transitionProgress(LINEAR, 1, 1.4, 4), 0);
    assert.equal(transitionProgress(LINEAR, 1, 1.5, 4), 0);
    assert.equal(transitionProgress(LINEAR, 1, 2, 4), 0.5);
    assert.equal(transitionProgress(LINEAR, 1, 2.25, 4), 0.75);
    assert.equal(transitionProgress(LINEAR, 1, 2.6, 4), 1);
  });

  it("eases the first half by Motion In and the second by Motion Out", () => {
    const motion = { motionIn: "Ease In", motionOut: "Ease Out" } as const;
    const quarter = transitionProgress(motion, 4, 1, 4);
    const threeQuarters = transitionProgress(motion, 4, 3, 4);
    // Ease In starts slowly; Ease Out ends slowly.
    assert.ok(quarter < 0.25, `${quarter}`);
    assert.ok(threeQuarters > 0.75, `${threeQuarters}`);
    assert.equal(transitionProgress(motion, 4, 2, 4), 0.5);
  });

  it("jumps through a half with None", () => {
    const motion = { motionIn: "None", motionOut: "Linear" } as const;
    assert.equal(transitionProgress(motion, 4, 0, 4), 0);
    assert.equal(transitionProgress(motion, 4, 0.1, 4), 0.5);
    assert.equal(transitionProgress(motion, 4, 3, 4), 0.75);
  });

  it("cuts at the middle of a clip with no length", () => {
    assert.equal(transitionProgress(LINEAR, 1, 0, 0), 1);
    assert.equal(transitionProgress(LINEAR, 0, 0.9, 2), 0);
    assert.equal(transitionProgress(LINEAR, 0, 1, 2), 1);
  });
});

describe("Transition settings", () => {
  it("reads the Type, Direction and Softness", () => {
    assert.deepEqual(
      parseTransitionSettings(
        [
          { key: "Type", value: "wipe" },
          { key: "Direction", value: "Down" },
          { key: "Softness", value: "0.5", numericValue: 0.5 },
        ],
        0.25,
      ),
      { type: "Wipe", direction: [0, -1], softness: 0.5, progress: 0.25 },
    );
  });

  it("falls back to the defaults", () => {
    assert.deepEqual(parseTransitionSettings([], 2), {
      type: DEFAULT_TRANSITION_TYPE.name,
      direction: [-1, 0],
      softness: 0.2,
      progress: 1,
    });
    assert.equal(parseTransitionDirection("sideways"), "Left");
    assert.equal(findTransitionType("Newer type"), DEFAULT_TRANSITION_TYPE);
  });
});

describe("Transition definition", () => {
  it("is only offered on FX clips", () => {
    assert.deepEqual(definition.scopes, ["fxClip"]);
  });

  it("lists the types in menu order", () => {
    assert.deepEqual(
      TRANSITION_TYPES.map((type) => type.name),
      [
        "Fade",
        "Dissolve",
        "Dissolve (Noise)",
        "Swipe",
        "Push",
        "Reveal",
        "Cover",
        "Wipe",
        "Zoom",
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
      ],
    );
    const type = definition.parameters.find(
      (parameter) => parameter.key === "Type",
    );
    assert.ok(type?.kind === "enum");
    assert.deepEqual(
      type.options,
      TRANSITION_TYPES.map(({ name }) => name),
    );
  });

  it("shows Direction and Softness only for the types that use them", () => {
    const visibility = (key: string) =>
      definition.parameters.find((parameter) => parameter.key === key)
        ?.visibleWhen;
    assert.deepEqual(visibility("Direction"), {
      key: "Type",
      values: ["Swipe", "Push", "Reveal", "Cover", "Wipe", "Flip", "Cube"],
    });
    assert.deepEqual(visibility("Softness"), {
      key: "Type",
      values: typesUsing("softness"),
    });
    assert.deepEqual(typesUsing("softness"), ["Wipe", "Burn"]);
  });

  it("builds a shader for every type", () => {
    for (const type of TRANSITION_TYPES) {
      const source = transitionFragmentSource(type);
      assert.match(source, /vec4 transitionColor\(vec2 uv, float p\)/);
      assert.ok(source.includes(type.glsl), type.name);
      assert.match(type.glsl, /return /, type.name);
    }
  });
});
