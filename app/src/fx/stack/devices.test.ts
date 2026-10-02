import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { migrateColorizeReactivity } from "../../project-state-compat.ts";
import { SPACING_MAX } from "../effects/order/order.ts";
import { GLOBAL_EFFECT_TRACK_ID } from "./clip-stacks.ts";
import { mapSessionEffectsToDevices } from "./devices.ts";
import {
  addEffect,
  ensureLayerLayouts,
  setEffectEnabled,
  setEffectParameter,
} from "./ops.ts";
import { load } from "./test-fixtures.ts";
import type { SessionEffect } from "./types.ts";

describe("mapSessionEffectsToDevices", () => {
  it("lists the layer stack in order, then the global stack", () => {
    const devices = mapSessionEffectsToDevices(load(), "6");
    assert.deepEqual(
      devices.map((device) => [device.name, device.group]),
      [
        ["Pixelate", "layer"],
        ["Colorize", "layer"],
        ["Negative Split", "layer"],
        ["Analog Glitch", "layer"],
        ["Layout", "global"],
      ],
    );
  });

  it("names the layer in subtitles", () => {
    const devices = mapSessionEffectsToDevices(load(), "6", "Layer 3");
    assert.equal(devices[0].subtitle, "Layer 3");
    assert.equal(devices[4].subtitle, "Global stack");
  });

  it("flags devices on a stack their effect isn't designed for", () => {
    const devices = mapSessionEffectsToDevices(
      [
        ...load(),
        {
          id: "layer-order",
          trackId: "6",
          effectName: "Order",
          enabled: true,
          parameters: [],
        },
        {
          id: "global-move",
          trackId: GLOBAL_EFFECT_TRACK_ID,
          effectName: "Transform",
          enabled: true,
          parameters: [],
        },
        {
          id: "global-mystery",
          trackId: GLOBAL_EFFECT_TRACK_ID,
          effectName: "Mystery",
          enabled: true,
          parameters: [],
        },
      ],
      "6",
    );
    assert.deepEqual(
      devices.map((device) => [device.name, device.unsupported ?? false]),
      [
        ["Pixelate", false],
        ["Colorize", false],
        ["Negative Split", false],
        ["Analog Glitch", false],
        ["Order", true],
        ["Layout", true],
        ["Transform", true],
        ["Mystery", false],
      ],
    );
  });

  it("uses friendly labels and hides internal parameters", () => {
    const [zoom] = mapSessionEffectsToDevices(load(), "1");
    assert.equal(zoom.name, "Zoom & Pan");
    const labels = zoom.parameters.map((parameter) => parameter.label);
    assert.deepEqual(labels, [
      "Start Zoom",
      "Start X",
      "Start Y",
      "End Zoom",
      "End X",
      "End Y",
    ]);
    assert.equal(zoom.parameters[3].display, "1.69×");
    assert.equal(zoom.parameters[4].display, "50%");

    // Loading the session drops Colorize's old Reactivity knob.
    const colorize = mapSessionEffectsToDevices(
      migrateColorizeReactivity(load()),
      "6",
    )[1];
    assert.deepEqual(
      colorize.parameters.map((parameter) => [
        parameter.label,
        parameter.display,
      ]),
      [["Hue Shift", "+90°"]],
    );
  });

  it("hides Colorize's old Reactivity knob sent by older peers", () => {
    // Remote snapshots are applied without migrating, so a peer on an older
    // build still sends `_Reactivity`.
    const colorize = mapSessionEffectsToDevices(load(), "6")[1];
    assert.deepEqual(
      colorize.parameters.map((parameter) => parameter.label),
      ["Hue Shift"],
    );
  });

  it("shows the Layout position as an enum", () => {
    const layout = mapSessionEffectsToDevices(load(), "6")[4];
    assert.equal(layout.parameters[0].kind, "enum");
    assert.equal(layout.parameters[0].stringValue, "Center");
    assert.deepEqual(layout.parameters[0].options, ["Center", "Top", "Bottom"]);
  });

  it("keeps unknown effects with their raw keys", () => {
    const effects: SessionEffect[] = [
      {
        id: "mystery",
        trackId: "1",
        effectName: "Mystery",
        parameters: [{ key: "_Amount", value: "0.250", numericValue: 0.25 }],
        enabled: true,
      },
    ];
    const devices = mapSessionEffectsToDevices(effects, "1");
    const mystery = devices.find((device) => device.id === "mystery");
    assert.equal(mystery?.name, "Mystery");
    assert.deepEqual(
      mystery?.parameters.map((parameter) => [
        parameter.label,
        parameter.display,
      ]),
      [["_Amount", "0.250"]],
    );
  });

  it("lists only real effects, with no placeholder Layout", () => {
    const layerOnly = load().filter(
      (effect) => effect.trackId !== GLOBAL_EFFECT_TRACK_ID,
    );
    const devices = mapSessionEffectsToDevices(layerOnly, "6");
    assert.ok(devices.every((device) => device.name !== "Layout"));
    assert.deepEqual(mapSessionEffectsToDevices([], "6"), []);
  });

  it("marks only a layer's own Layout as its default device", () => {
    const effects = ensureLayerLayouts(load(), ["6"]);
    const [layout, pixelate] = mapSessionEffectsToDevices(effects, "6");
    assert.equal(layout.name, "Layout");
    assert.equal(layout.group, "layer");
    assert.equal(layout.layerDefault, true);
    assert.equal(pixelate.layerDefault, undefined);
    assert.equal(
      mapSessionEffectsToDevices(load(), "6")[4].layerDefault,
      undefined,
    );
  });

  it("reports bypassed devices", () => {
    const effects = setEffectEnabled(load(), "colorize", false);
    const colorize = mapSessionEffectsToDevices(effects, "6")[1];
    assert.equal(colorize.enabled, false);
  });

  it("treats a missing bypass flag as enabled", () => {
    const effects = load().map((effect) => ({
      ...effect,
      enabled: undefined as unknown as boolean,
    }));
    const devices = mapSessionEffectsToDevices(effects, "6");
    assert.ok(devices.every((device) => device.enabled));
    assert.equal(setEffectEnabled(effects, "colorize", true), effects);
  });
});

describe("Order devices", () => {
  function orderDevice(
    arrangement: string,
    activeLayerCount: number,
    enabled = true,
    excludedLayers?: string,
  ) {
    let effects = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Order", 0, "order");
    effects = setEffectParameter(effects, "order", "Arrangement", arrangement);
    effects = setEffectEnabled(effects, "order", enabled);
    if (excludedLayers !== undefined) {
      effects = setEffectParameter(
        effects,
        "order",
        "ExcludedLayers",
        excludedLayers,
      );
    }
    return mapSessionEffectsToDevices(
      effects,
      "6",
      "Layer 3",
      Array.from({ length: activeLayerCount }, (_, index) => `${index + 1}`),
    ).find((device) => device.id === "order");
  }

  it("shows Grid Size only while the arrangement is Grid", () => {
    const keys = (arrangement: string) =>
      orderDevice(arrangement, 0)?.parameters.map((parameter) => parameter.key);
    assert.deepEqual(keys("Vertical"), [
      "Arrangement",
      "ExcludedLayers",
      "Spacing",
      "Margin",
      "BorderColor",
    ]);
    assert.deepEqual(keys("Horizontal"), [
      "Arrangement",
      "ExcludedLayers",
      "Spacing",
      "Margin",
      "BorderColor",
    ]);
    assert.deepEqual(keys("Grid"), [
      "Arrangement",
      "ExcludedLayers",
      "GridSize",
      "Spacing",
      "Margin",
      "BorderColor",
    ]);
  });

  it("gives Margin the same range as Spacing", () => {
    const knob = (key: string) =>
      orderDevice("Vertical", 0)?.parameters.find(
        (parameter) => parameter.key === key,
      );
    const margin = knob("Margin");
    const spacing = knob("Spacing");
    assert.ok(margin?.kind === "number" && spacing?.kind === "number");
    assert.equal(margin.label, "Margin");
    assert.equal(margin.numericValue, 0);
    assert.equal(margin.display, spacing.display);
    for (const field of ["min", "max", "step"] as const) {
      assert.equal(margin[field], spacing[field], field);
    }
    assert.equal(margin.max, SPACING_MAX);
  });

  it("dims Border only while Spacing and Margin are 0", () => {
    const border = (spacing?: number, margin?: number) => {
      let effects = addEffect([], GLOBAL_EFFECT_TRACK_ID, "Order", 0, "order");
      if (spacing !== undefined) {
        effects = setEffectParameter(effects, "order", "Spacing", spacing);
      }
      if (margin !== undefined) {
        effects = setEffectParameter(effects, "order", "Margin", margin);
      }
      return mapSessionEffectsToDevices(effects, "6")
        .find((device) => device.id === "order")
        ?.parameters.find((parameter) => parameter.key === "BorderColor");
    };
    assert.equal(border()?.kind, "color");
    assert.equal(border()?.label, "Border");
    assert.equal(border()?.stringValue, "rgba(0,0,0,1)");
    assert.equal(border()?.dimmed, true);
    assert.equal(border(0)?.dimmed, true);
    assert.equal(border(20)?.dimmed, undefined);
    assert.equal(border(0, 0)?.dimmed, true);
    assert.equal(border(0, 30)?.dimmed, undefined);
  });

  it("warns when a grid has fewer cells than active layers", () => {
    assert.equal(orderDevice("Grid", 4)?.warning, undefined);
    assert.equal(orderDevice("Grid", 5)?.warning, "1 layer hidden by grid");
    assert.equal(orderDevice("Grid", 7)?.warning, "3 layers hidden by grid");
    assert.equal(orderDevice("Vertical", 7)?.warning, undefined);
    assert.equal(orderDevice("Grid", 7, false)?.warning, undefined);
  });

  it("counts only the layers the Order arranges for the grid warning", () => {
    assert.equal(orderDevice("Grid", 5, true, "1")?.warning, undefined);
    assert.equal(
      orderDevice("Grid", 7, true, "2")?.warning,
      "2 layers hidden by grid",
    );
    // Excluding a layer with nothing at the playhead changes nothing.
    assert.equal(
      orderDevice("Grid", 5, true, "9")?.warning,
      "1 layer hidden by grid",
    );
  });

  it("gives the Layers control the stored exclusions, empty by default", () => {
    const layers = (excluded?: string) =>
      orderDevice("Vertical", 0, true, excluded)?.parameters.find(
        (parameter) => parameter.key === "ExcludedLayers",
      );
    assert.equal(layers()?.kind, "layers");
    assert.equal(layers()?.stringValue, "");
    assert.equal(layers("1,4")?.stringValue, "1,4");
  });

  it("shows Gain as an audio device with a fader and a Mute toggle", () => {
    const effects = addEffect([], "clip:c1", "Gain", undefined, "gain");
    const [device] = mapSessionEffectsToDevices(
      effects,
      "1",
      "Layer 1",
      [],
      new Set(),
      "clip:c1",
    );
    assert.equal(device?.domain, "audio");
    assert.equal(device?.supportsAnimation, false);
    assert.equal(device?.unsupported, undefined);
    assert.deepEqual(
      device?.parameters.map((parameter) => [
        parameter.key,
        parameter.control,
        parameter.numericValue,
        parameter.display,
      ]),
      [
        ["Gain", "fader", 0, "0.0 dB"],
        ["Mute", "toggle", 0, "Off"],
      ],
    );
    const muted = setEffectParameter(effects, "gain", "Gain", -68);
    assert.equal(
      mapSessionEffectsToDevices(
        muted,
        "1",
        "Layer 1",
        [],
        new Set(),
        "clip:c1",
      )[0]?.parameters[0]?.display,
      "Mute",
    );
  });

  it("marks video devices as video", () => {
    const [device] = mapSessionEffectsToDevices(
      addEffect([], "1", "Pixelate", undefined, "p"),
      "1",
    );
    assert.equal(device?.domain, "video");
  });
});
