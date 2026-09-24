import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FX_COLLAPSED_STORAGE_KEY,
  getParameterFormat,
  groupChainDevices,
  knobColumnCount,
  readCollapsedDevices,
  toggleCollapsedDevice,
  writeCollapsedDevices,
} from "./fx-chain.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  mapSessionEffectsToDevices,
  type SessionEffect,
} from "./fx-stack.ts";

function effect(
  id: string,
  trackId: string,
  effectName: string,
): SessionEffect {
  return { id, trackId, effectName, parameters: [], enabled: true };
}

// Layer 3 of dogfood3.lvp, plus its Global Layout.
const DOGFOOD_EFFECTS = [
  effect("fx-1", "3", "Pixelate"),
  effect("fx-2", "3", "Colorize"),
  effect("fx-global", GLOBAL_EFFECT_TRACK_ID, "Layout"),
  effect("fx-3", "3", "NegativeSplit"),
  effect("fx-4", "3", "AnalogGlitch"),
  effect("fx-other", "1", "ZoomAndPan"),
];

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("groupChainDevices", () => {
  it("lists the layer stack in order, then the Global stack", () => {
    const groups = groupChainDevices(
      mapSessionEffectsToDevices(DOGFOOD_EFFECTS, "3", "video", "Layer 3"),
      "video",
    );
    assert.deepEqual(
      groups.layer.map((device) => device.name),
      ["Pixelate", "Colorize", "Negative Split", "Analog Glitch"],
    );
    assert.deepEqual(
      groups.global.map((device) => device.name),
      ["Layout"],
    );
  });

  it("drops the placeholder Layout device", () => {
    const groups = groupChainDevices(
      mapSessionEffectsToDevices([], "2", "video", "Layer 2"),
      "video",
    );
    assert.deepEqual(groups, { layer: [], global: [] });
  });

  it("shows no devices for audio clips", () => {
    const groups = groupChainDevices(
      mapSessionEffectsToDevices(DOGFOOD_EFFECTS, "3", "audio", "Layer 3"),
      "audio",
    );
    assert.deepEqual(groups, { layer: [], global: [] });
  });
});

describe("getParameterFormat", () => {
  it("uses the registry format for known parameters", () => {
    assert.equal(getParameterFormat("Colorize", "_HueOffset")(0.5), "+180°");
    assert.equal(getParameterFormat("Pixelate", "_NumPixels")(12.4), "12");
  });

  it("falls back to raw numbers for unknown parameters", () => {
    assert.equal(getParameterFormat("Mystery", "_Amount")(0.25), "0.250");
  });
});

describe("knobColumnCount", () => {
  it("fills two rows before adding columns", () => {
    assert.equal(knobColumnCount(0), 1);
    assert.equal(knobColumnCount(1), 1);
    assert.equal(knobColumnCount(2), 1);
    assert.equal(knobColumnCount(3), 2);
    assert.equal(knobColumnCount(6), 3);
  });
});

describe("collapsed device storage", () => {
  it("round-trips collapsed device ids", () => {
    const storage = memoryStorage();
    writeCollapsedDevices(storage, new Set(["fx-2", "fx-1"]));
    assert.equal(
      storage.values.get(FX_COLLAPSED_STORAGE_KEY),
      '["fx-1","fx-2"]',
    );
    assert.deepEqual(
      Array.from(readCollapsedDevices(storage)).sort(),
      ["fx-1", "fx-2"],
    );
  });

  it("ignores missing, malformed and non-string entries", () => {
    assert.equal(readCollapsedDevices(undefined).size, 0);
    assert.equal(readCollapsedDevices(memoryStorage()).size, 0);
    assert.equal(
      readCollapsedDevices(
        memoryStorage({ [FX_COLLAPSED_STORAGE_KEY]: "{not json" }),
      ).size,
      0,
    );
    assert.deepEqual(
      Array.from(
        readCollapsedDevices(
          memoryStorage({ [FX_COLLAPSED_STORAGE_KEY]: '["fx-1", 4, null]' }),
        ),
      ),
      ["fx-1"],
    );
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readCollapsedDevices(broken).size, 0);
    assert.doesNotThrow(() => writeCollapsedDevices(broken, new Set(["fx-1"])));
  });

  it("toggles one device without mutating the input", () => {
    const collapsed = new Set(["fx-1"]);
    assert.deepEqual(
      Array.from(toggleCollapsedDevice(collapsed, "fx-2")).sort(),
      ["fx-1", "fx-2"],
    );
    assert.deepEqual(Array.from(toggleCollapsedDevice(collapsed, "fx-1")), []);
    assert.deepEqual(Array.from(collapsed), ["fx-1"]);
  });
});
