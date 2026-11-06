import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEffect,
  GLOBAL_EFFECT_TRACK_ID,
  removeEffect,
  type SessionEffect,
} from "./fx-stack.ts";
import {
  assignKeyMapping,
  findKeyMapping,
  type KeyMapKeyEvent,
  type KeyMapping,
  type KeyMapTarget,
  keyLabel,
  mappableKey,
  pressKeyMapTarget,
  pruneKeyMappings,
  readKeyMappings,
  removeKeyMapping,
} from "./key-map.ts";

function press(key: string, modifiers: Partial<KeyMapKeyEvent> = {}) {
  return mappableKey({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  });
}

function effect(effectName: string, id: string) {
  return { ...createEffect(GLOBAL_EFFECT_TRACK_ID, effectName, id), id };
}

function editedBy(effects: SessionEffect[], target: KeyMapTarget) {
  const pressed = pressKeyMapTarget(effects, target);
  assert.equal(pressed?.kind, "edit");
  return pressed?.kind === "edit" ? pressed : assert.fail();
}

const POWER: KeyMapTarget = { kind: "power", effectId: "a" };
const MODIFIER: KeyMapTarget = { kind: "modifier", effectId: "a" };

describe("mappableKey", () => {
  it("folds a character's case, so Shift+Q is Q", () => {
    assert.equal(press("q"), "q");
    assert.equal(press("Q", { shiftKey: true }), "q");
    assert.equal(press("!", { shiftKey: true }), "!");
  });

  it("refuses Space, Escape and Ctrl, Cmd and Alt combinations", () => {
    assert.equal(press(" "), undefined);
    assert.equal(press("Escape"), undefined);
    assert.equal(press("q", { ctrlKey: true }), undefined);
    assert.equal(press("q", { metaKey: true }), undefined);
    assert.equal(press("q", { altKey: true }), undefined);
  });

  it("refuses modifiers, and the keys that move focus or remove a mapping", () => {
    for (const key of ["Shift", "Control", "Meta", "Tab", "Delete", "Dead"]) {
      assert.equal(press(key), undefined, key);
    }
  });

  it("takes named keys, but leaves Shift with them to the shortcuts", () => {
    assert.equal(press("ArrowLeft"), "ArrowLeft");
    assert.equal(press("F2"), "F2");
    assert.equal(press("ArrowLeft", { shiftKey: true }), undefined);
    assert.equal(press("F10", { shiftKey: true }), undefined);
  });
});

describe("keyLabel", () => {
  it("shows characters in capitals and arrows as arrows", () => {
    assert.equal(keyLabel("q"), "Q");
    assert.equal(keyLabel("ArrowLeft"), "←");
    assert.equal(keyLabel("F2"), "F2");
  });
});

describe("key mappings", () => {
  it("gives a button one key, and a key any number of buttons", () => {
    const one = assignKeyMapping(undefined, POWER, "q");
    const two = assignKeyMapping(one, MODIFIER, "q");
    assert.equal(two?.length, 2);
    const remapped = assignKeyMapping(two, POWER, "w");
    assert.equal(remapped?.length, 2);
    assert.equal(findKeyMapping(remapped, POWER)?.key, "w");
    assert.equal(findKeyMapping(remapped, MODIFIER)?.key, "q");
  });

  it("changes nothing mapping a button to the key it already has", () => {
    const mappings = assignKeyMapping(undefined, POWER, "q");
    assert.equal(assignKeyMapping(mappings, POWER, "q"), mappings);
  });

  it("removes a mapping, leaving none once the last is gone", () => {
    const mappings = assignKeyMapping(undefined, POWER, "q");
    assert.equal(removeKeyMapping(mappings, MODIFIER), mappings);
    assert.equal(removeKeyMapping(mappings, POWER), undefined);
  });

  it("drops the mappings of effects that are gone", () => {
    const mappings: KeyMapping[] = [
      { key: "q", target: POWER },
      { key: "w", target: { kind: "power", effectId: "b" } },
    ];
    const effects = [effect("Gain", "a"), effect("Gain", "b")];
    assert.equal(pruneKeyMappings(mappings, effects), mappings);
    assert.deepEqual(pruneKeyMappings(mappings, removeEffect(effects, "b")), [
      { key: "q", target: POWER },
    ]);
    assert.equal(pruneKeyMappings(mappings, []), undefined);
  });

  it("reads back only what an opened session can use", () => {
    const effects = [effect("Gain", "a")];
    assert.equal(readKeyMappings(undefined, effects), undefined);
    assert.equal(readKeyMappings("nonsense", effects), undefined);
    assert.deepEqual(
      readKeyMappings(
        [
          { key: "q", target: POWER },
          { key: "w", target: { kind: "power", effectId: "gone" } },
          { key: " ", target: MODIFIER },
          { key: "e", target: { kind: "unknown", effectId: "a" } },
          { key: "r", target: { kind: "pad", effectId: "a", parameter: "p" } },
          { target: MODIFIER },
          null,
        ],
        effects,
      ),
      [{ key: "q", target: POWER }],
    );
  });
});

describe("pressKeyMapTarget", () => {
  it("bypasses and enables a device, labeled as clicking it is", () => {
    const effects = [effect("Gain", "a")];
    const bypassed = editedBy(effects, POWER);
    assert.equal(bypassed.effects[0].enabled, false);
    assert.equal(bypassed.label, "Bypass Gain");
    assert.equal(editedBy(bypassed.effects, POWER).effects[0].enabled, true);
  });

  it("switches Modulation on an audio device and Animation on a video one", () => {
    const gain = editedBy([effect("Compressor", "a")], MODIFIER);
    assert.equal(gain.effects[0].modulation?.enabled, true);
    const bloom = [effect("Bloom", "a")];
    const animated = bloom[0].animation?.enabled === true;
    const toggled = editedBy(bloom, MODIFIER);
    assert.equal(toggled.effects[0].animation?.enabled, !animated);
    assert.equal(
      editedBy(toggled.effects, MODIFIER).effects[0].animation?.enabled,
      animated,
    );
  });

  it("flips a toggle parameter", () => {
    const target: KeyMapTarget = {
      kind: "toggle",
      effectId: "a",
      parameter: "Mute",
    };
    const muted = editedBy([effect("Gain", "a")], target);
    const read = (effects: SessionEffect[]) =>
      effects[0].parameters.find((parameter) => parameter.key === "Mute")
        ?.numericValue;
    assert.equal(read(muted.effects), 1);
    assert.equal(read(editedBy(muted.effects, target).effects), 0);
  });

  it("does nothing for a device or parameter that is gone", () => {
    const effects = [effect("Gain", "a")];
    assert.equal(
      pressKeyMapTarget(effects, { kind: "power", effectId: "gone" }),
      undefined,
    );
    assert.equal(
      pressKeyMapTarget(effects, {
        kind: "option",
        effectId: "a",
        parameter: "Nope",
        value: "x",
      }),
      undefined,
    );
  });
});
