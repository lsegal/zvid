import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PALETTE } from "../../../app/constants.ts";
import type { ProjectState } from "../../../app/types.ts";
import { addFromMenu, device } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  colorEffect,
  pixelAtFraction,
  type Rgba,
  syntheticClip,
  syntheticLanes,
  syntheticState,
} from "../../../component-test/fx-scenes.ts";
import {
  EMPTY_PROJECT,
  mediaItem,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  pixelAt,
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import { analyzeMediaSelection } from "../../../harness/web-media.ts";
import { isEffectMedia, rejectMalformedLuts } from "../../../media.ts";
import { setLutMedia } from "./lut-media.ts";
import "./pass.ts";

// The LUT effect (#1135): a .cube file imported as media grades a layer
// through a 3D lookup table, blended in by Intensity.

// A 2-point LUT that inverts each channel.
const INVERT_CUBE = [
  'TITLE "Invert"',
  "LUT_3D_SIZE 2",
  "1 1 1",
  "0 1 1",
  "1 0 1",
  "0 0 1",
  "1 1 0",
  "0 1 0",
  "1 0 0",
  "0 0 0",
  "",
].join("\n");

// Every color to pure red, so the default gray fill visibly changes.
const RED_CUBE = ["LUT_3D_SIZE 2", ...Array(8).fill("1 0 0"), ""].join("\n");

const PREVIEW = { width: 320, height: 180 };

// The fill clip spans quarters 0-8; the preview is read in its middle.
const PLAYHEAD_Q = 4;

// The preview's color left of center.
async function previewColor(project: ProjectState) {
  const frame = await renderFrame(rendererState(project, PREVIEW), PLAYHEAD_Q);
  return pixelAtFraction(frame, 0.3, 0.5);
}

const isRed = ([red, green, blue]: Rgba) =>
  red > 240 && green < 15 && blue < 15;

describe("LUT", { timeout: 60_000 }, () => {
  test("an imported .cube is checked on import and grades the layer once picked", async () => {
    let project: ProjectState = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(undefined),
    ).project;
    expect(isRed(await previewColor(project))).toBe(false);

    await render(
      <FxEditor
        project={project}
        selection={{ laneId: "1" }}
        playheadQ={PLAYHEAD_Q}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    try {
      await addFromMenu("Add device to this layer", "Color", "LUT", "Video");
      const lut = () => device("LUT");
      await expect.poll(() => lut().elements().length).toBe(1);
      await expect.element(lut().getByText("Intensity")).toBeVisible();

      // Without LUT media, the picker says how to get some.
      const trigger = () => lut().getByRole("button", { name: /^LUT: / });
      await expect.element(trigger()).toHaveAccessibleName("LUT: None");
      await userEvent.click(trigger());
      await expect
        .element(page.getByText("Import a .cube file as media to use it here."))
        .toBeVisible();
      await userEvent.keyboard("{Escape}");

      // Importing a malformed file and a good one: the import turns the
      // malformed one away with the reason, and keeps the good one, which
      // only feeds effects, so makes no clips.
      const { accepted, message } = rejectMalformedLuts(
        await analyzeMediaSelection(
          {
            kind: "files",
            files: [
              new File(["LUT_3D_SIZE 2\n0 0 0\n"], "broken.cube"),
              new File([RED_CUBE], "red.cube"),
            ],
          },
          PALETTE,
          0,
        ),
      );
      expect(message).toMatch(
        /Skipped broken\.cube \(Not a valid \.cube LUT: .*8 points/,
      );
      expect(accepted.map((item) => item.name)).toEqual(["red.cube"]);
      expect(accepted.every(isEffectMedia)).toBe(true);
      // The app hands the project's media to the LUT effect.
      setLutMedia(accepted);

      await userEvent.click(trigger());
      await userEvent.click(
        page.getByRole("menuitemcheckbox", { name: "red.cube" }),
      );
      await expect.element(trigger()).toHaveAccessibleName("LUT: red.cube");
      expect(isRed(await previewColor(project))).toBe(true);
    } finally {
      setLutMedia([]);
    }
  });
});

const WIDTH = 64;
const HEIGHT = 32;

let nextLut = 0;

// The center of a WIDTH×HEIGHT frame of a `color` fill on Layer 1 under
// LUT with `cube` as its media at `intensity`, as export renders it.
async function renderLut(cube: string, color: string, intensity: number) {
  const url = URL.createObjectURL(new Blob([cube]));
  const media = mediaItem({
    id: `lut-${++nextLut}`,
    name: "look.cube",
    kind: "lut",
    durationSeconds: 0,
    hasVideo: false,
    previewUrl: url,
    availability: "ready",
  });
  setLutMedia([media]);
  try {
    // An exact frame waits for the LUT.
    const frame = await renderFrame(
      syntheticState(WIDTH, HEIGHT, {
        mediaItems: [media],
        clips: [syntheticClip("1")],
        lanes: syntheticLanes(1),
        effects: [
          colorEffect("1", color),
          {
            id: "lut-1",
            trackId: "1",
            effectName: "LUT",
            enabled: true,
            parameters: [
              { key: "LUT", value: "Custom:look.cube" },
              {
                key: "_Intensity",
                value: String(intensity),
                numericValue: intensity,
              },
            ],
          },
        ],
      }),
      1,
      0.5,
    );
    // The e2e spec read the pixel at height / 2 counted from the bottom.
    return pixelAt(frame, WIDTH / 2, HEIGHT - 1 - HEIGHT / 2);
  } finally {
    setLutMedia([]);
    URL.revokeObjectURL(url);
  }
}

// Each output channel is the square of its input, over 17 points a side.
function squareCube() {
  const size = 17;
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        lines.push(
          [r, g, b].map((index) => (index / (size - 1)) ** 2).join(" "),
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

const near = (actual: Rgba, expected: number[], tolerance = 4) =>
  expected.every(
    (value, channel) => Math.abs(actual[channel] - value) <= tolerance,
  );

describe("LUT rendering", { timeout: 60_000 }, () => {
  test("maps colors through the LUT on the GPU, interpolating between points", async () => {
    const inverted = await renderLut(INVERT_CUBE, "rgba(51,153,204,1)", 1);
    expect(near(inverted, [204, 102, 51]), String(inverted)).toBe(true);
    // 0.3 falls between the points at 0.25 and 0.3125: trilinear
    // interpolation lands within a step of 0.09.
    const squared = await renderLut(squareCube(), "rgba(77,128,230,1)", 1);
    const expected = [77, 128, 230].map((value) => (value / 255) ** 2 * 255);
    expect(near(squared, expected, 5), `${squared} vs ${expected}`).toBe(true);
  });

  test("blends by Intensity and leaves the picture at 0", async () => {
    const color = "rgba(51,153,204,1)";
    expect(near(await renderLut(INVERT_CUBE, color, 0), [51, 153, 204])).toBe(
      true,
    );
    expect(
      near(await renderLut(INVERT_CUBE, color, 0.5), [128, 128, 128]),
    ).toBe(true);
  });

  test("leaves the picture as it is for a malformed file", async () => {
    const color = "rgba(51,153,204,1)";
    expect(
      near(await renderLut("LUT_3D_SIZE 2\n0 0 0\n", color, 1), [51, 153, 204]),
    ).toBe(true);
  });
});
