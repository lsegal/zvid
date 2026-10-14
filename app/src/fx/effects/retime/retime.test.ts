import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEffectDefinition } from "../../../fx-registry.ts";
import {
  blendFrames,
  gridFrameSpans,
  parseRetimeSettings,
  RETIME_EFFECT_NAME,
  resolveRetime,
  retimeSeconds,
  snapSpeed,
  wrapMediaTime,
} from "./retime.ts";

const retime = (
  speed: string,
  interpolation = "None",
  extra: { trackId?: string; enabled?: boolean } = {},
) => ({
  trackId: "clip:a",
  effectName: RETIME_EFFECT_NAME,
  parameters: [
    { key: "Speed", value: speed },
    { key: "Interpolation", value: interpolation },
  ],
  ...extra,
});

describe("Retime definition", () => {
  it("offers Speed from -5× to 5× in 0.1 steps, default 1×, on clip stacks", () => {
    const definition = getEffectDefinition(RETIME_EFFECT_NAME);
    assert.equal(definition.known, true);
    assert.deepEqual(definition.scopes, ["clip"]);
    const speed = definition.parameters.find((p) => p.key === "Speed");
    assert.ok(speed?.kind === "number");
    assert.equal(speed.min, -5);
    assert.equal(speed.max, 5);
    assert.equal(speed.step, 0.1);
    assert.equal(speed.defaultValue, 1);
    assert.equal(speed.format(-1.5), "-1.5×");
    const interpolation = definition.parameters.find(
      (p) => p.key === "Interpolation",
    );
    assert.ok(interpolation?.kind === "enum");
    assert.deepEqual(interpolation.options, ["None", "Blend"]);
    assert.equal(interpolation.defaultValue, "None");
  });
});

describe("parseRetimeSettings", () => {
  it("snaps Speed to the 0.1 grid within -5 to 5", () => {
    assert.equal(snapSpeed(0.26), 0.3);
    assert.equal(snapSpeed(-1.04), -1);
    assert.equal(snapSpeed(9), 5);
    assert.equal(snapSpeed(-9), -5);
    assert.equal(Object.is(snapSpeed(-0.01), -0), false);
    assert.equal(snapSpeed(Number.NaN), 1);
  });

  it("reads the stored number first, and the interpolation case-insensitively", () => {
    assert.deepEqual(
      parseRetimeSettings([
        { key: "Speed", value: "2", numericValue: -2.5 },
        { key: "Interpolation", value: "blend" },
      ]),
      { speed: -2.5, interpolation: "Blend" },
    );
    assert.deepEqual(parseRetimeSettings([]), {
      speed: 1,
      interpolation: "None",
    });
  });
});

describe("resolveRetime", () => {
  it("leaves a clip at 1× with no interpolation as it is", () => {
    assert.equal(resolveRetime([retime("1")], "clip:a"), undefined);
    assert.deepEqual(resolveRetime([retime("1", "Blend")], "clip:a"), {
      speed: 1,
      interpolation: "Blend",
    });
  });

  it("multiplies several Retimes' speeds, skipping disabled ones and other stacks", () => {
    assert.deepEqual(
      resolveRetime(
        [
          retime("2"),
          retime("3", "None", { enabled: false }),
          retime("4", "None", { trackId: "clip:b" }),
          retime("-0.5", "Blend"),
        ],
        "clip:a",
      ),
      { speed: -1, interpolation: "Blend" },
    );
  });
});

describe("retimeSeconds and wrapMediaTime", () => {
  it("scales time around the clip's start", () => {
    assert.equal(retimeSeconds(3, 1, 2), 5);
    assert.equal(retimeSeconds(3, 1, -1), -1);
    assert.equal(retimeSeconds(3, 1, 0), 1);
  });

  it("loops times before the media's start back from its end", () => {
    assert.equal(wrapMediaTime(-1, 4), 3);
    assert.equal(wrapMediaTime(-9, 4), 3);
    assert.equal(wrapMediaTime(9, 4), 1);
    assert.equal(wrapMediaTime(2, 4), 2);
    assert.equal(wrapMediaTime(-1, 0), 0);
  });
});

describe("blendFrames", () => {
  it("crossfades from a video frame's middle toward the next by how far through it the time is", () => {
    const { from, to, weight } = blendFrames(1.025, gridFrameSpans(1.025, 20));
    assert.ok(Math.abs(from - 1.025) < 1e-9);
    assert.ok(Math.abs(to - 1.075) < 1e-9);
    assert.ok(Math.abs(weight - 0.5) < 1e-9);
  });

  it("shows a time at a frame's start as that frame alone", () => {
    assert.equal(blendFrames(1, gridFrameSpans(1, 20)).weight, 0);
  });

  it("follows uneven frames, such as a GIF's", () => {
    const { from, to, weight } = blendFrames(0.15, {
      current: { start: 0.1, end: 0.3 },
      next: { start: 0.3, end: 0.35 },
    });
    assert.ok(Math.abs(from - 0.2) < 1e-9);
    assert.ok(Math.abs(to - 0.325) < 1e-9);
    assert.ok(Math.abs(weight - 0.25) < 1e-9);
  });
});
