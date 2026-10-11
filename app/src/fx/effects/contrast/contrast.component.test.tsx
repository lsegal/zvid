import { describe, expect, test } from "vitest";
import type { Locator } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import {
  addFromMenu,
  device,
  typeValue,
} from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  withTextClip,
} from "../../../component-test/fx-projects.ts";
import {
  meanChange,
  rendererState,
  renderFrame,
  rowAt,
} from "../../../component-test/fx-render.ts";
import type { SessionEffect } from "../../../fx-stack";
import "./pass.ts";

// Contrast (#1128): pushes each channel away from, or pulls it toward, a
// pivot gray. Added from a layer's Video → Color menu, and rendered in real
// WebGL on small synthetic frames.

type Rgba = number[];

const PREVIEW = { width: 320, height: 180 };

// Types `value` into the Contrast knob's readout.
async function setContrast(contrast: Locator, value: string) {
  await typeValue(contrast, "Contrast", value);
  await expect
    .element(contrast.getByRole("slider", { name: "Contrast" }))
    .toHaveAttribute("aria-valuetext", Number(value).toFixed(3));
}

describe("Contrast", { timeout: 60_000 }, () => {
  test("is added from a layer's Video → Color menu and changes the picture as its knob moves", async () => {
    // A text clip on layer 1, previewed in its middle.
    let project: ProjectState = withTextClip(EMPTY_PROJECT).project;
    const preview = () => renderFrame(rendererState(project, PREVIEW), 4);
    const plain = await preview();

    await render(
      <FxEditor
        project={project}
        selection={{ laneId: "1" }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    await addFromMenu("Add device to this layer", "Color", "Contrast", "Video");

    const contrast = device("Contrast");
    await expect
      .element(contrast.getByRole("slider", { name: "Contrast" }))
      .toHaveAttribute("aria-valuetext", "1.000");
    await expect
      .element(contrast.getByRole("slider", { name: "Pivot" }))
      .toHaveAttribute("aria-valuetext", "0.435");
    // A static grading tool, it comes with Animation off.
    await expect
      .element(
        contrast.getByRole("button", {
          name: "Turn Animation On for Contrast",
        }),
      )
      .toHaveAttribute("aria-pressed", "false");

    // The default Contrast of 1 leaves the picture as it was.
    expect(meanChange(await preview(), plain)).toBeLessThan(0.02);

    // Contrast 0 flattens the text toward the pivot gray. Only the text box
    // is drawn on the layer, so most of the frame is left as it was.
    await setContrast(contrast, "0");
    const flat = await preview();
    expect(meanChange(flat, plain)).toBeGreaterThan(0.05);

    // Contrast 2 steepens it instead.
    await setContrast(contrast, "2");
    expect(meanChange(await preview(), flat)).toBeGreaterThan(0.05);

    // Back at 1, it is untouched again.
    await setContrast(contrast, "1");
    expect(meanChange(await preview(), plain)).toBeLessThan(0.02);
  });
});

// A `width`×`height` frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1, with a Contrast of `contrast` about `pivot` on the
// layer, or none when `contrast` is undefined. Returns every pixel of the
// middle row as RGBA.
async function renderRow(
  paint: string,
  contrast: number | undefined,
  pivot = 0.435,
  width = 64,
  height = 36,
): Promise<Rgba[]> {
  const gradient = paint.includes("gradient");
  const effects: SessionEffect[] = [
    {
      id: "color-1",
      trackId: "1",
      effectName: "Color",
      enabled: true,
      parameters: [
        { key: "Mode", value: gradient ? "Gradient" : "Solid" },
        { key: gradient ? "Gradient" : "Color", value: paint },
        { key: "Opacity", value: "1", numericValue: 1 },
      ],
    },
  ];
  if (contrast !== undefined) {
    effects.push({
      id: "contrast-1",
      trackId: "1",
      effectName: "Contrast",
      enabled: true,
      parameters: [
        { key: "_Contrast", value: String(contrast), numericValue: contrast },
        { key: "_Pivot", value: String(pivot), numericValue: pivot },
      ],
    });
  }
  const frame = await renderFrame(
    {
      mediaItems: [],
      clips: [
        {
          id: "fill-1",
          kind: "fill",
          sourceSpanId: "",
          sourceTrackId: "",
          laneId: "1",
          label: "Fill",
          mediaPath: "",
          startQ: 0,
          durationSeconds: 4,
          trimStartSeconds: 0,
          sourceOffsetSeconds: 0,
          sourceWindowStartSeconds: 0,
          sourceWindowEndSeconds: 4,
          tint: "#000",
          accent: "#fff",
        },
      ],
      lanes: [{ id: "1", name: "Layer 1", colorIndex: 0 }],
      effects,
      bpm: 120,
      fps: 30,
      canvasWidth: width,
      canvasHeight: height,
    },
    1,
    0.5,
  );
  // The e2e spec read the row at height / 2 counted from the bottom.
  return rowAt(frame, height - 1 - Math.floor(height / 2));
}

// Black at the left edge to white at the right.
const RAMP =
  "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(255,255,255,1) 100%)";

// What the shader does to one 0..255 level.
function expected(level: number, contrast: number, pivot: number) {
  const value = (level / 255 - pivot) * contrast + pivot;
  return Math.min(Math.max(value, 0), 1) * 255;
}

describe("Contrast rendering", { timeout: 60_000 }, () => {
  test("Contrast 1 leaves the frame as it was", async () => {
    const plain = await renderRow(RAMP, undefined);
    expect(await renderRow(RAMP, 1)).toEqual(plain);
    expect(await renderRow(RAMP, 1, 0.9)).toEqual(plain);
  });

  test("each channel moves by (c - pivot) * contrast + pivot, clamped", async () => {
    const plain = await renderRow(RAMP, undefined);
    for (const [contrast, pivot] of [
      [0.5, 0.435],
      [2, 0.435],
      [1.5, 0.25],
    ]) {
      const row = await renderRow(RAMP, contrast, pivot);
      for (let x = 0; x < row.length; x++) {
        for (let channel = 0; channel < 3; channel++) {
          expect(
            Math.abs(
              row[x][channel] - expected(plain[x][channel], contrast, pivot),
            ),
            `contrast ${contrast}, pivot ${pivot}, x = ${x}`,
          ).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  test("the Pivot gray stays fixed at any Contrast", async () => {
    // 0.435 of 255 is 111.
    const gray = "rgba(111,111,111,1)";
    for (const contrast of [0, 0.5, 2]) {
      const row = await renderRow(gray, contrast);
      for (const pixel of [row[0], row[32], row[63]]) {
        for (const level of pixel.slice(0, 3)) {
          expect(Math.abs(level - 111), `contrast ${contrast}`).toBeLessThan(2);
        }
      }
    }
  });

  test("Contrast 0 flattens the frame to the Pivot gray", async () => {
    for (const pivot of [0.435, 0.8]) {
      const row = await renderRow(RAMP, 0, pivot);
      for (const pixel of row) {
        for (const level of pixel.slice(0, 3)) {
          expect(Math.abs(level - pivot * 255), `pivot ${pivot}`).toBeLessThan(
            2,
          );
        }
      }
    }
  });

  test("a translucent picture keeps its alpha", async () => {
    // Half-covered white over the background: flattened to the pivot gray,
    // it must still cover the background by half rather than more or less.
    const translucent = "rgba(255,255,255,0.5)";
    const background = (await renderRow("rgba(0,0,0,0)", undefined))[32];
    const plain = (await renderRow(translucent, undefined))[32];
    const coverage = (plain[0] - background[0]) / (255 - background[0]);
    expect(coverage).toBeGreaterThan(0.3);
    expect(coverage).toBeLessThan(0.7);
    const flat = (await renderRow(translucent, 0))[32];
    for (let channel = 0; channel < 3; channel++) {
      const want =
        0.435 * 255 * coverage + background[channel] * (1 - coverage);
      expect(Math.abs(flat[channel] - want), `channel ${channel}`).toBeLessThan(
        3,
      );
    }
    expect(flat[3]).toEqual(plain[3]);
  });
});
