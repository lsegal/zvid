import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import { getSwatch } from "../../../app/util.ts";
import {
  addFromMenu,
  device,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  fillState,
  layerEffect,
  middleRow,
  type Parameter,
  parameters,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  pixelAt,
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import "./pass.ts";

// Bloom (#825): bright areas glow into their surroundings. Added from a
// layer's Video → Stylize menu, and rendered in real WebGL on a small
// synthetic frame.

type Rgba = number[];

const PREVIEW = { width: 320, height: 180 };

// How far apart two colors are, in their most different channel.
function difference(left: number[], right: number[]) {
  return Math.max(
    ...left.map((value, index) => Math.abs(value - right[index])),
  );
}

describe("Bloom", { timeout: 60_000 }, () => {
  test("is added from a layer's Video → Stylize menu with its defaults and lights up the preview", async () => {
    // A fill clip on layer 1, as Insert Fill Clip makes it, selected and
    // previewed in its middle.
    const fill = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(getSwatch(EMPTY_PROJECT.lanes[0].colorIndex).accent),
    );
    let project: ProjectState = fill.project;
    // The color a quarter of the way in from the preview's top-left corner.
    const previewColor = async () =>
      pixelAt(
        await renderFrame(rendererState(project, PREVIEW), 4),
        PREVIEW.width / 4,
        PREVIEW.height / 4,
      ).slice(0, 3);
    const onChange = (history: { present: ProjectState }) => {
      project = history.present;
    };

    const screen = await render(
      <FxEditor
        key="editor"
        project={project}
        selection={{ clipId: fill.clip.id }}
        onChange={onChange}
      />,
    );
    // A gradient whose colors all sit below Bloom's default Threshold.
    await userEvent.click(
      device("Color").getByRole("button", { name: "Gradient" }),
    );
    const plain = await previewColor();

    // Clicking the layer header selects the layer.
    await screen.rerender(
      <FxEditor
        key="editor"
        project={project}
        selection={{ laneId: "1" }}
        onChange={onChange}
      />,
    );
    await addFromMenu("Add device to this layer", "Stylize", "Bloom", "Video");

    const bloom = device("Bloom");
    for (const [label, text] of [
      ["Threshold", "70%"],
      ["Intensity", "60%"],
      ["Radius", "40%"],
    ]) {
      await expect
        .element(bloom.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", text);
    }
    await expect
      .element(bloom.getByText("Tint", { exact: true }))
      .toBeVisible();
    const animation = bloom.getByRole("button", {
      name: "Turn Animation Off for Bloom",
    });
    await expect.element(animation).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(animation);

    // Nothing is above the default Threshold, so the frame is unchanged.
    expect(difference(await previewColor(), plain)).toBeLessThan(4);

    // At Threshold 0 everything glows, brightening the frame.
    await typeValue(bloom, "Threshold", "0");
    await expect
      .element(bloom.getByRole("slider", { name: "Threshold" }))
      .toHaveAttribute("aria-valuetext", "0%");
    const color = await previewColor();
    expect(
      Math.min(...color.map((value, index) => value - plain[index])),
    ).toBeGreaterThan(16);
  });
});

const WIDTH = 320;
const HEIGHT = 180;

// A WIDTH×HEIGHT frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1, with a Bloom of `values` on the layer, or none when
// they are undefined. Returns every pixel of the middle row as RGBA.
async function renderRow(
  paint: string,
  values: Parameter[] | undefined,
): Promise<Rgba[]> {
  const effects = values ? [layerEffect("Bloom", values)] : [];
  return middleRow(
    await renderFrame(
      fillState(paint, effects, { width: WIDTH, height: HEIGHT }),
      1,
      0.5,
    ),
  );
}

// Bloom's parameters: its defaults, overridden by `values`, and `tint`.
function bloom(values: Record<string, number> = {}, tint?: string) {
  const numbers = parameters({
    _Threshold: 0.7,
    _Intensity: 0.6,
    _Radius: 0.4,
    ...values,
  });
  return tint ? [...numbers, { key: "_Tint", value: tint }] : numbers;
}

// Black on the left half, white on the right, with a hard edge between.
const HALF_WHITE =
  "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(255,255,255,1) 50%, rgba(255,255,255,1) 100%)";

// The first white pixel of a HALF_WHITE row.
function edgeOf(row: Rgba[]) {
  return row.findIndex(([red]) => red > 128);
}

describe("Bloom rendering", { timeout: 60_000 }, () => {
  test("Intensity 0 leaves the frame as it was", async () => {
    const plain = await renderRow(HALF_WHITE, undefined);
    expect(
      await renderRow(HALF_WHITE, bloom({ _Intensity: 0, _Radius: 1 })),
    ).toEqual(plain);
  });

  test("a frame with every pixel below Threshold is unchanged", async () => {
    const gray = "rgba(150,150,150,1)";
    const plain = await renderRow(gray, undefined);
    expect(await renderRow(gray, bloom({ _Intensity: 2, _Radius: 1 }))).toEqual(
      plain,
    );
  });

  test("bright areas glow smoothly into the dark beside them", async () => {
    const plain = await renderRow(HALF_WHITE, undefined);
    const edge = edgeOf(plain);
    expect(edge).toBeGreaterThan(140);
    expect(edge).toBeLessThan(180);
    expect(plain[edge - 2][0]).toBeLessThan(8);

    const row = await renderRow(HALF_WHITE, bloom());
    // The default reach: 40% of 12% of the 180 px side.
    const reach = Math.round(0.4 * 0.12 * HEIGHT);
    const glow = (x: number) => row[x][0];
    expect(glow(edge - 1)).toBeGreaterThan(24);
    expect(glow(edge - 1)).toBeGreaterThan(glow(edge - Math.ceil(reach / 2)));
    expect(glow(edge - Math.ceil(reach / 2))).toBeGreaterThan(0);
    // Away from the edge the dark stays dark and the white stays white.
    expect(row[edge - reach - 4].slice(0, 3)).toEqual(
      plain[edge - reach - 4].slice(0, 3),
    );
    expect(row[10].slice(0, 3)).toEqual([0, 0, 0]);
    expect(row[WIDTH - 10].slice(0, 3)).toEqual([255, 255, 255]);
    // A white glow stays neutral.
    const [red, green, blue] = row[edge - 1];
    expect(Math.abs(red - green)).toBeLessThan(4);
    expect(Math.abs(red - blue)).toBeLessThan(4);

    // No banding: the glow falls off without steps between neighbors.
    for (let x = edge - reach; x < edge - 1; x++) {
      expect(Math.abs(glow(x + 1) - glow(x)), `x = ${x}`).toBeLessThan(48);
    }
  });

  test("Tint colors the glow and Radius spreads it", async () => {
    const edge = edgeOf(await renderRow(HALF_WHITE, undefined));

    const red = await renderRow(HALF_WHITE, bloom({}, "#ff0000"));
    expect(red[edge - 1][0]).toBeGreaterThan(24);
    expect(red[edge - 1][1]).toBeLessThan(4);
    expect(red[edge - 1][2]).toBeLessThan(4);

    const wide = await renderRow(HALF_WHITE, bloom({ _Radius: 1 }));
    const narrow = await renderRow(HALF_WHITE, bloom({ _Radius: 0.2 }));
    expect(wide[edge - 12][0]).toBeGreaterThan(narrow[edge - 12][0]);
  });
});
