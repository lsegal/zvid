import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import {
  addFromMenu,
  device,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import {
  BLUE,
  CYAN,
  effect,
  expectColors,
  RED,
  type Rgb,
  renderOrder,
  renderScene,
  type Samples,
  sampleColors,
  sceneClip,
  solidColor,
  YELLOW,
} from "../../../component-test/fx-clip.tsx";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import type { SessionEffect } from "../../../fx-stack";
import "../../../composition-fx-clip.ts";

// Opacity fades a clip inside its layer, and the layer, by multiplying what
// they are drawn at; on an FX clip it mixes the clip's effects over what
// they apply to. The compositor the preview and the export share is driven
// in real WebGL and sampled.

// `amount` of `over` on `under`.
function mixed(under: Rgb, over: Rgb, amount: number): Rgb {
  return under.map((value, index) =>
    Math.round(value + (over[index] - value) * amount),
  ) as Rgb;
}

function opacity(trackId: string, value: number, id = `opacity-${trackId}`) {
  return effect(id, trackId, "Opacity", { Opacity: value });
}

// Inverts every color: red becomes cyan and blue yellow.
const invert = (trackId: string) =>
  effect(`invert-${trackId}`, trackId, "NegativeSplit", {
    _LowIntensity: 1,
    _HighIntensity: 1,
  });

// Layer 1 is a red fill clip over the top half of the canvas, Layer 3 a
// blue fill over the whole canvas, both 0-4 s, and Layer 2 has an FX clip
// "fx-2" over 0-2 s. Returns the `size`×`size` frame at 1 s.
function renderLayers(effects: SessionEffect[], size = 100) {
  return renderScene(
    3,
    [
      sceneClip("fill-1", "fill", "1", 0, 4),
      sceneClip("fx-2", "fx", "2", 0, 2),
      sceneClip("fill-3", "fill", "3", 0, 4),
    ],
    [
      solidColor("color-1", "1", "#ff0000"),
      solidColor("color-3", "3", "#0000ff"),
      effect("transform-1", "1", "Transform", {
        ScaleY: 0.5,
        PositionY: -0.25,
      }),
      ...effects,
    ],
    1,
    size,
  );
}

// Layer 1 over Layer 3, and Layer 3 alone.
const SAMPLES: Samples = [
  [0.5, 0.25],
  [0.5, 0.75],
];

async function colors(effects: SessionEffect[], size?: number) {
  return sampleColors(await renderLayers(effects, size), SAMPLES);
}

describe("Opacity on clips and layers", { timeout: 60_000 }, () => {
  test("at 100% draws exactly as without it", async () => {
    const plain = await renderLayers([]);
    for (const trackId of ["1", "clip:fill-1"]) {
      const opaque = await renderLayers([opacity(trackId, 1)]);
      expect(Array.from(opaque.pixels)).toEqual(Array.from(plain.pixels));
    }
  });

  test("hides the clip at 0% and blends it halfway at 50%", async () => {
    expectColors(await colors([opacity("clip:fill-1", 0)]), [BLUE, BLUE]);
    expectColors(await colors([opacity("clip:fill-1", 0.5)]), [
      mixed(BLUE, RED, 0.5),
      BLUE,
    ]);
  });

  test("fades a layer, and a clip inside its layer", async () => {
    expectColors(await colors([opacity("1", 0.5)]), [
      mixed(BLUE, RED, 0.5),
      BLUE,
    ]);
    expectColors(
      await colors([opacity("1", 0.5), opacity("clip:fill-1", 0.5)]),
      [mixed(BLUE, RED, 0.25), BLUE],
    );
  });

  test("draws the same in the preview and in export", async () => {
    const effects = [opacity("1", 0.6), opacity("clip:fill-1", 0.5)];
    const preview = await colors(effects, 90);
    expectColors(preview, [mixed(BLUE, RED, 0.3), BLUE]);
    expectColors(await colors(effects, 360), preview);
  });
});

describe("Opacity on an FX clip", { timeout: 60_000 }, () => {
  test("mixes its effects over the layers beneath it", async () => {
    const fx = "clip:fx-2";
    expectColors(await colors([invert(fx)]), [RED, YELLOW]);
    expectColors(await colors([invert(fx), opacity(fx, 1)]), [RED, YELLOW]);
    expectColors(await colors([invert(fx), opacity(fx, 0.25)]), [
      RED,
      mixed(BLUE, YELLOW, 0.25),
    ]);
    expectColors(await colors([invert(fx), opacity(fx, 0)]), [RED, BLUE]);
  });

  test("mixes them only where its Mask lets them", async () => {
    // The FX clip on Layer 1 inverts Layers 2 and 3 only where Layer 2's
    // red top half draws.
    const render = async (amount: number) =>
      sampleColors(
        await renderScene(
          3,
          [
            sceneClip("fx-1", "fx", "1", 0, 2),
            sceneClip("fill-2", "fill", "2", 0, 4),
            sceneClip("fill-3", "fill", "3", 0, 4),
          ],
          [
            solidColor("color-2", "2", "#ff0000"),
            solidColor("color-3", "3", "#0000ff"),
            effect("transform-2", "2", "Transform", {
              ScaleY: 0.5,
              PositionY: -0.25,
            }),
            invert("clip:fx-1"),
            effect("mask", "clip:fx-1", "Mask", {
              Target: "2",
              Mode: "Additive",
            }),
            opacity("clip:fx-1", amount),
          ],
          1,
          100,
        ),
        SAMPLES,
      );
    expectColors(await render(1), [CYAN, BLUE]);
    expectColors(await render(0.5), [mixed(RED, CYAN, 0.5), BLUE]);
    expectColors(await render(0), [RED, BLUE]);
  });

  test("mixes its effects over its Order's arrangement", async () => {
    const order = effect("order", "clip:fx-1", "Order", {
      Arrangement: "Horizontal",
      GridSize: 2,
      Spacing: 0,
    });
    const scenario = {
      layers: ["fx", "#ff0000", "#0000ff"],
      playheadSeconds: 1,
      samples: [
        [0.25, 0.5],
        [0.75, 0.5],
      ] as Samples,
    };
    expectColors(
      await renderOrder({
        ...scenario,
        effects: [order, invert("clip:fx-1"), opacity("clip:fx-1", 0.25)],
      }),
      [mixed(RED, CYAN, 0.25), mixed(BLUE, YELLOW, 0.25)],
    );
    expectColors(
      await renderOrder({
        ...scenario,
        effects: [order, invert("clip:fx-1"), opacity("clip:fx-1", 0)],
      }),
      [RED, BLUE],
    );
  });

  test("mixes its effects over its Transition's blend", async () => {
    const transition = {
      ...effect("transition", "clip:fx-1", "Transition", {
        Type: "Push",
        Direction: "Left",
      }),
      animation: {
        enabled: true,
        mode: "clip",
        clip: { motionIn: "Linear", motionOut: "Linear", timing: "Full" },
      },
    } as SessionEffect;
    const render = async (amount: number) =>
      sampleColors(
        await renderScene(
          2,
          [
            sceneClip("fx-1", "fx", "1", 0, 2),
            sceneClip("fill-2", "fill", "2", 0, 4),
          ],
          [
            solidColor("color-2", "2", "#ff0000"),
            transition,
            invert("clip:fx-1"),
            opacity("clip:fx-1", amount),
          ],
          1,
          100,
        ),
        [[0.5, 0.5]],
      );
    expectColors(await render(1), [CYAN]);
    expectColors(await render(0.25), [mixed(RED, CYAN, 0.25)]);
    expectColors(await render(0), [RED]);
  });
});

describe("the Opacity device", { timeout: 60_000 }, () => {
  test("is added from a clip's Video → Transform menu and fades it", async () => {
    let { project, clip } = withFillClip(EMPTY_PROJECT, "#ff0000");
    await render(
      <FxEditor
        project={project}
        selection={{ clipId: clip.id }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    await addFromMenu(
      "Add device to this clip",
      "Transform",
      "Opacity",
      "Video",
    );
    const fade = device("Opacity");
    const knob = fade.getByRole("slider", { name: "Opacity" });
    await expect.element(knob).toHaveAttribute("aria-valuetext", "100%");
    // Clip mode fades the clip in and out from the start.
    await expect
      .element(
        fade.getByRole("button", { name: "Turn Animation Off for Opacity" }),
      )
      .toHaveAttribute("aria-pressed", "true");

    await typeValue(fade, "Opacity", "0.4");
    await expect.element(knob).toHaveAttribute("aria-valuetext", "40%");
    const stored = project.effects.find(
      (effect) => effect.effectName === "Opacity",
    );
    expect(stored?.trackId).toBe(`clip:${clip.id}`);
    expect(
      stored?.parameters.map((parameter) => parameter.numericValue),
    ).toEqual([0.4]);
    expect(stored?.animation?.mode).toBe("clip");
  });
});
