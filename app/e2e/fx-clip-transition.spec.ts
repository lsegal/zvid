import { expect, type Page, test } from "@playwright/test";
import { addLayers } from "./layers.ts";

// A Transition on an FX clip blends from the comp beneath the clip at its
// start to the comp at its end, an Order's arranged layers counting as one
// comp. The compositor the preview and the export share is driven in real
// WebGL and sampled; the timeline flow adds Transition from an FX clip's add
// menu, the only one that offers it.

type Rgb = [number, number, number];

type Fill = {
  layer: number;
  color: string;
  start: number;
  end: number;
};

// Renders, at `playheadSeconds`, a Transition FX clip on Layer 1 over 1-3 s
// (Push Left, spanning the clip, linear), an FX clip Order on Layer 2
// arranging the layers beneath it in columns over 0-2 s, and `fills`, then
// returns the pixels at `samples`, fractions of the canvas from its top-left
// corner.
async function render(
  page: Page,
  fills: Fill[],
  playheadSeconds: number,
  samples: Array<[number, number]>,
) {
  return page.evaluate(
    async ({ fills, playheadSeconds, samples }) => {
      // A variable keeps TypeScript from resolving the dev server's path.
      const modulePath = "/src/CompositionPlayer.tsx";
      const { CompositionRenderer } = await import(
        /* @vite-ignore */ modulePath
      );
      const size = 120;
      const lanes = [1, 2, 3, 4, 5].map((number) => ({
        id: `${number}`,
        name: `Layer ${number}`,
        colorIndex: number,
      }));
      const clip = (
        id: string,
        kind: string,
        laneId: string,
        start: number,
        end: number,
      ) => ({
        id,
        kind,
        sourceTrackId: "",
        laneId,
        label: id,
        mediaPath: "",
        // 120 BPM: two quarters a second.
        startQ: start * 2,
        durationSeconds: end - start,
        trimStartSeconds: 0,
        sourceOffsetSeconds: 0,
        sourceWindowStartSeconds: 0,
        sourceWindowEndSeconds: end - start,
        tint: "#000",
        accent: "#fff",
      });
      const clips = [
        clip("transition", "fx", "1", 1, 3),
        clip("order", "fx", "2", 0, 2),
        ...fills.map((fill, index) =>
          clip(`fill-${index}`, "fill", `${fill.layer}`, fill.start, fill.end),
        ),
      ];
      const parameters = (values: Record<string, string>) =>
        Object.entries(values).map(([key, value]) => ({ key, value }));
      const effects = [
        {
          id: "transition-effect",
          trackId: "clip:transition",
          effectName: "Transition",
          enabled: true,
          parameters: parameters({ Type: "Push", Direction: "Left" }),
          animation: {
            enabled: true,
            mode: "clip",
            clip: { motionIn: "Linear", motionOut: "Linear", timing: "Full" },
          },
        },
        {
          id: "order-effect",
          trackId: "clip:order",
          effectName: "Order",
          enabled: true,
          parameters: parameters({ Arrangement: "Horizontal", Spacing: "0" }),
        },
        ...fills.map((fill, index) => ({
          id: `color-${index}`,
          trackId: `clip:fill-${index}`,
          effectName: "Color",
          enabled: true,
          parameters: [
            { key: "Mode", value: "Solid" },
            { key: "Color", value: fill.color },
            { key: "Opacity", value: "1", numericValue: 1 },
          ],
        })),
      ];

      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [],
          clips,
          lanes,
          effects,
          bpm: 120,
          canvasWidth: size,
          canvasHeight: size,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        await renderer.renderFrameAt(playheadSeconds * 2, playheadSeconds);
        const gl = canvas.getContext("webgl");
        if (!gl) throw new Error("WebGL is unavailable.");
        const all = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, all);
        return samples.map(([x, y]) => {
          const offset =
            ((size - 1 - Math.floor(y * size)) * size + Math.floor(x * size)) *
            4;
          return [all[offset], all[offset + 1], all[offset + 2]];
        });
      } finally {
        renderer.destroy();
      }
    },
    { fills, playheadSeconds, samples },
  ) as Promise<Rgb[]>;
}

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const YELLOW: Rgb = [255, 255, 0];

function expectColors(actual: Rgb[], expected: Rgb[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, color] of expected.entries()) {
    for (const [channel, value] of color.entries()) {
      expect(
        Math.abs(actual[index][channel] - value),
        `sample ${index}: rgb(${actual[index]})`,
      ).toBeLessThan(8);
    }
  }
}

// The Order arranges red, green and blue on Layers 3-5 until the cut at
// 2 s, when yellow comes in on Layer 3 alone.
const ORDER_THEN_NEXT: Fill[] = [
  { layer: 3, color: "#ff0000", start: 0, end: 2 },
  { layer: 4, color: "#00ff00", start: 0, end: 2 },
  { layer: 5, color: "#0000ff", start: 0, end: 2 },
  { layer: 3, color: "#ffff00", start: 2, end: 4 },
];
const ACROSS: Array<[number, number]> = [
  [0.05, 0.5],
  [0.25, 0.5],
  [0.45, 0.5],
  [0.55, 0.5],
  [0.95, 0.5],
];

test.describe("Transition compositing", () => {
  test("starts on the Order's arranged group", async ({ page }) => {
    await page.goto("/");
    expectColors(await render(page, ORDER_THEN_NEXT, 1, ACROSS), [
      RED,
      RED,
      GREEN,
      GREEN,
      BLUE,
    ]);
  });

  test("pushes the arranged group off as one picture across the cut", async ({
    page,
  }) => {
    await page.goto("/");
    // Halfway, the group's right half (the end of green, then blue) fills
    // the left half, and yellow fills the right.
    expectColors(await render(page, ORDER_THEN_NEXT, 2, ACROSS), [
      GREEN,
      BLUE,
      BLUE,
      YELLOW,
      YELLOW,
    ]);
    // Before the cut the next clip is held on its first frame.
    const beforeCut = await render(page, ORDER_THEN_NEXT, 1.9, [[0.95, 0.5]]);
    expectColors(beforeCut, [YELLOW]);
  });

  test("ends on the next clip alone", async ({ page }) => {
    await page.goto("/");
    expectColors(await render(page, ORDER_THEN_NEXT, 2.99, ACROSS), [
      YELLOW,
      YELLOW,
      YELLOW,
      YELLOW,
      YELLOW,
    ]);
  });
});

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// The Transform submenu of the add menu `button` opens, by name.
async function transformMenu(page: Page, button: string) {
  await page.getByRole("button", { name: button }).click();
  await page
    .getByRole("menuitem", { name: "Transform", exact: true })
    .first()
    .press("ArrowRight");
  const items = page.getByRole("menu").last().getByRole("menuitem");
  await expect(items.first()).toBeVisible();
  const names = await items.allTextContents();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  return names;
}

// Layer 1 and the added Layer 2 both fit at this size.
test.use({ viewport: { width: 1600, height: 1200 } });
test("only an FX clip's add menu offers Transition", async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await addLayers(page, 1);

  // An FX clip offers it.
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert FX Clip" })
    .click();
  const clip = lane(page, "1").locator(".clip-card--fx");
  await expect(clip).toHaveCount(1);

  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page
    .getByRole("menuitem", { name: "Transform", exact: true })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Transition/ }).click();
  await expect(clip.locator("strong")).toHaveText("FX · Transition");

  // Its Animation section holds Timing, spanning the clip by default,
  // Motion In, Motion Out and Type.
  const animation = page.locator('section[aria-label="Transition animation"]');
  for (const name of ["Motion In", "Motion Out", "Type"]) {
    await expect(animation.getByRole("combobox", { name })).toBeVisible();
  }
  await expect(
    animation.getByRole("button", { name: "Full", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // A layer and the Global stack don't offer it.
  await page.locator('[data-layer-header-id="2"]').click();
  for (const button of ["Add device to this layer", "Add device to Global"]) {
    const names = await transformMenu(page, button);
    expect(names.some((name) => name.startsWith("Zoom & Pan"))).toBe(true);
    expect(names.some((name) => name.startsWith("Transition"))).toBe(false);
  }

  // Nor does a layer clip's own stack.
  await page.locator('[data-layer-header-id="2"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert text at playhead" }).click();
  await expect(lane(page, "2").locator(".clip-card--selected")).toHaveCount(1);
  const names = await transformMenu(page, "Add device to this clip");
  expect(names.some((name) => name.startsWith("Transform"))).toBe(true);
  expect(names.some((name) => name.startsWith("Transition"))).toBe(false);
});
