import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PALETTE } from "../../../app/constants.ts";
import type { ProjectState } from "../../../app/types.ts";
import { addFromMenu, device } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  EMPTY_PROJECT,
  mediaItem,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import {
  colorEffect,
  pixelAtFraction,
  type Rgba,
  syntheticClip,
  syntheticLanes,
  syntheticState,
} from "../../../component-test/fx-scenes.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import { analyzeMediaSelection } from "../../../harness/web-media.ts";
import { isSvgMedia, rejectMalformedLuts } from "../../../media.ts";
import { setShapeImageMedia } from "./custom-mask.ts";
import "./pass.ts";

// Shape ▸ Custom (#1008): an SVG imported as media masks a layer to its
// opaque area, stretched over the layer's box like the built-in shapes.

// Opaque in its left half only, in red: the mask is the alpha, not the
// color. Its square viewBox is stretched over whatever box it masks.
const LEFT_HALF_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
  '<rect x="0" y="0" width="5" height="10" fill="#f00"/></svg>';

const PREVIEW = { width: 320, height: 180 };

// The fill clip spans quarters 0-8; the preview is read in its middle.
const PLAYHEAD_Q = 4;

const distance = (a: Rgba, b: Rgba) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

describe("Shape ▸ Custom", { timeout: 60_000 }, () => {
  test("an imported SVG masks the layer through Shape ▸ Custom", async () => {
    let project: ProjectState = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(undefined),
    ).project;
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
      await addFromMenu(
        "Add device to this layer",
        "Transform",
        "Shape",
        "Video",
      );
      const shape = () => device("Shape");
      await expect.poll(() => shape().elements().length).toBe(1);

      // Without SVG media, Custom says how to get some.
      const trigger = () => shape().getByRole("button", { name: /^Shape: / });
      const options = () =>
        page.elementLocator(
          document.querySelector(".fx-shape__grid") ?? document.body,
        );
      await userEvent.click(trigger());
      await expect
        .poll(() => document.querySelectorAll(".fx-shape__grid [role=option]"))
        .toHaveLength(5);
      await userEvent.click(
        options().getByRole("option").filter({ hasText: "Custom" }),
      );
      await expect
        .element(page.getByText(/Import an SVG as media/))
        .toBeVisible();
      await userEvent.keyboard("{Escape}");

      // Importing an SVG reads it as an image, which Shape ▸ Custom can
      // mask with; the app hands the project's media to Shape.
      const { accepted, message } = rejectMalformedLuts(
        await analyzeMediaSelection(
          {
            kind: "files",
            files: [
              new File([LEFT_HALF_SVG], "half.svg", { type: "image/svg+xml" }),
            ],
          },
          PALETTE,
          0,
        ),
      );
      expect(message).toBeUndefined();
      expect(accepted.map((item) => [item.name, item.kind])).toEqual([
        ["half.svg", "image"],
      ]);
      expect(accepted.every(isSvgMedia)).toBe(true);
      setShapeImageMedia(accepted);

      await userEvent.click(trigger());
      await userEvent.click(
        options().getByRole("option").filter({ hasText: "Custom" }),
      );
      const svgOption = page
        .getByRole("listbox", { name: "SVG media" })
        .getByRole("option", { name: "half.svg" });
      // The option previews the SVG black on white.
      await expect
        .poll(
          () =>
            svgOption.element().querySelectorAll(".fx-shape__custom-mask")
              .length,
        )
        .toBe(1);
      await userEvent.click(svgOption);
      await expect.poll(() => page.getByRole("listbox").elements()).toEqual([]);
      await expect.element(trigger()).toHaveAccessibleName("Shape: Custom");
      expect(
        trigger()
          .element()
          .querySelector(".fx-shape__custom-mask")
          ?.getAttribute("style"),
      ).toMatch(/mask-image: url\("blob:/);

      // The new Shape's Transform is a square centered in the canvas, half
      // its height across: the SVG's opaque left half keeps the layer, its
      // clear right half and the canvas outside the box show the background.
      const frame = await renderFrame(
        rendererState(project, PREVIEW),
        PLAYHEAD_Q,
      );
      const halfWidth = (PREVIEW.height / PREVIEW.width) * 0.25;
      const [left, right, outside] = [
        pixelAtFraction(frame, 0.5 - halfWidth / 2, 0.5),
        pixelAtFraction(frame, 0.5 + halfWidth / 2, 0.5),
        // Beside the box.
        pixelAtFraction(frame, 0.15, 0.5),
      ];
      expect(distance(left, outside), `${left} vs ${outside}`).toBeGreaterThan(
        60,
      );
      expect(distance(right, outside), `${right} vs ${outside}`).toBeLessThan(
        20,
      );
    } finally {
      setShapeImageMedia([]);
    }
  });
});

const WIDTH = 200;
const HEIGHT = 100;

let nextSvg = 0;

// A WIDTH×HEIGHT frame of a white fill on Layer 1 under Shape ▸ Custom with
// `svg` as its media, read at `points`, in fractions from the top-left.
async function renderCustomPoints(
  svg: string,
  points: Array<[number, number]>,
) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const media = mediaItem({
    id: `svg-${++nextSvg}`,
    name: "mask.svg",
    kind: "image",
    durationSeconds: 0,
    hasVideo: false,
    previewUrl: url,
    availability: "ready",
  });
  setShapeImageMedia([media]);
  try {
    // An exact frame waits for the SVG.
    const frame = await renderFrame(
      syntheticState(WIDTH, HEIGHT, {
        mediaItems: [media],
        clips: [syntheticClip("1")],
        lanes: syntheticLanes(1),
        effects: [
          colorEffect("1", "rgba(255,255,255,1)"),
          {
            id: "shape-1",
            trackId: "1",
            effectName: "Shape",
            enabled: true,
            parameters: [{ key: "Shape", value: "Custom:mask.svg" }],
          },
        ],
      }),
      1,
      0.5,
    );
    return points.map(([x, y]) => pixelAtFraction(frame, x, y));
  } finally {
    setShapeImageMedia([]);
    URL.revokeObjectURL(url);
  }
}

const isWhite = ([red]: Rgba) => red > 230;
const isDark = ([red]: Rgba) => red < 25;

describe("Shape ▸ Custom rendering", { timeout: 60_000 }, () => {
  test("keeps the layer where the SVG is opaque, stretched over the box", async () => {
    // The square SVG is stretched over the 2:1 frame, so its left half
    // covers x 0..0.5 of the frame at every height.
    const pixels = await renderCustomPoints(LEFT_HALF_SVG, [
      [0.1, 0.1],
      [0.45, 0.9],
      [0.55, 0.1],
      [0.9, 0.9],
    ]);
    expect(isWhite(pixels[0])).toBe(true);
    expect(isWhite(pixels[1])).toBe(true);
    expect(isDark(pixels[2])).toBe(true);
    expect(isDark(pixels[3])).toBe(true);
  });

  test("ignores the SVG's own aspect ratio setting", async () => {
    // A circle that would be letterboxed into the middle of the 2:1 frame
    // without stretching reaches the frame's left and right edges.
    const pixels = await renderCustomPoints(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" preserveAspectRatio="xMidYMid meet"><circle cx="10" cy="10" r="10" fill="#00f"/></svg>',
      [
        [0.04, 0.5],
        [0.96, 0.5],
        [0.5, 0.5],
        [0.04, 0.05],
      ],
    );
    expect(isWhite(pixels[0])).toBe(true);
    expect(isWhite(pixels[1])).toBe(true);
    expect(isWhite(pixels[2])).toBe(true);
    expect(isDark(pixels[3])).toBe(true);
  });
});
