import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVisualState } from "./composition-active-clips.ts";
import { FX_EFFECT_DEFINITIONS, getEffectDomain } from "./fx-registry.ts";
import { clipEffectTrackId, createEffect } from "./fx-stack.ts";

const LANE = "lane";
const CLIP = "clip";
const DEFAULTS = resolveVisualState([], LANE, CLIP);

const SOUND_EFFECTS = FX_EFFECT_DEFINITIONS.filter(
  (definition) => getEffectDomain(definition) !== "video",
).map((definition) => definition.effectName);

describe("audio and MIDI effects in the visual state (#1439)", () => {
  it("leaves a layer's and a clip's visual state at its defaults", () => {
    for (const effectName of ["Reverb", "Delay", "Chorus"]) {
      for (const trackId of [LANE, clipEffectTrackId(CLIP)]) {
        assert.deepEqual(
          resolveVisualState([createEffect(trackId, effectName)], LANE, CLIP),
          DEFAULTS,
          `${effectName} on ${trackId}`,
        );
      }
    }
  });

  it("ignores every audio and MIDI effect's parameters", () => {
    assert.ok(SOUND_EFFECTS.includes("Reverb"));
    assert.ok(SOUND_EFFECTS.includes("Arpeggiator"));
    for (const effectName of SOUND_EFFECTS) {
      assert.deepEqual(
        resolveVisualState([createEffect(LANE, effectName)], LANE, CLIP),
        DEFAULTS,
        effectName,
      );
    }
  });

  it("still fades a layer by an unrecognized effect's Mix, as video", () => {
    const fade = createEffect(LANE, "Reverb");
    const visual = resolveVisualState(
      [{ ...fade, effectName: "Unrecognized" }],
      LANE,
      CLIP,
    );
    assert.equal(visual.opacity, 0.25);
  });
});
