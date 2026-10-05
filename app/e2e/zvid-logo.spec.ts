import { expect, type Page, test } from "@playwright/test";
import session from "../src/sample/zvid-opening.project.json" with {
  type: "json",
};

// The zvid logo (#1070): the top bar's brand mark, the mask the opening
// sample cuts its 1.5 s shot to, and the sample's dark logo thumbnail (#1079).

type Rgba = [number, number, number, number];

test("the top bar shows the zvid logo beside the wordmark", async ({
  page,
}) => {
  await page.goto("/");
  const mark = page.locator(".brand-mark");
  const logo = mark.locator("svg");
  await expect(logo).toHaveAttribute("viewBox", "-8 -8 258 212");
  await expect(logo).toHaveAttribute("aria-hidden", "true");
  await expect(logo.locator("path")).toHaveCount(3);
  await expect(logo.locator("circle")).toHaveCount(0);

  // About 24 × 20 px, in the logo's aspect, centered on the wordmark.
  const logoBox = await logo.boundingBox();
  const nameBox = await mark.locator(".brand-mark__name").boundingBox();
  expect(logoBox).not.toBeNull();
  expect(nameBox).not.toBeNull();
  if (!logoBox || !nameBox) return;
  expect(logoBox.height).toBeCloseTo(20, 0);
  expect(logoBox.width).toBeCloseTo((20 * 258) / 212, 0);
  expect(logoBox.x + logoBox.width).toBeLessThan(nameBox.x);
  expect(
    Math.abs(logoBox.y + logoBox.height / 2 - (nameBox.y + nameBox.height / 2)),
  ).toBeLessThan(3);
});

// The favicon bolt's purple (#1085), as sRGB or its Display-P3 equivalent.
const BRAND_PURPLE =
  /^(rgb\(134, 59, 255\)|color\(display-p3 0\.5252 0\.23 1\))$/;

test("the top bar's logo and wordmark are the brand purple", async ({
  page,
}) => {
  await page.goto("/");
  const mark = page.locator(".brand-mark");
  const logo = mark.locator("svg");
  const style = (property: "fill" | "color" | "opacity") =>
    logo.evaluate(
      (element, property) => getComputedStyle(element)[property],
      property,
    );
  expect(await style("fill")).toMatch(BRAND_PURPLE);
  expect(await style("opacity")).toBe("1");
  expect(
    await mark
      .locator(".brand-mark__name")
      .evaluate((element) => getComputedStyle(element).color),
  ).toMatch(BRAND_PURPLE);
});

test("the favicon is the zvid logo in the brand purple", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page
    .locator('link[rel="icon"]')
    .evaluate((element) => (element as HTMLLinkElement).href);
  const response = await request.get(href);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  const svg = await response.text();
  expect(svg.match(/<svg\b[^>]*>/)?.[0]).toContain('fill="#863bff"');
  expect(svg).toContain('viewBox="-8 -8 258 212"');
  expect(svg.match(/<path\b/g)).toHaveLength(3);
});

const WIDTH = 960;
const HEIGHT = 540;

// The sample's own effects on its logo hold clip, as the renderer takes
// them, on Layer 1.
function holdEffects() {
  return session.effects
    .filter((effect) => effect.trackId === "clip:fill-logo-hold")
    .map((effect) => ({
      id: effect.id,
      trackId: "1",
      effectName: effect.effectName,
      enabled: true,
      parameters: Object.entries(
        effect.parameters as Record<
          string,
          { stringValue?: string; floatValue?: number }
        >,
      ).map(([key, value]) =>
        value.floatValue === undefined
          ? { key, value: value.stringValue ?? "" }
          : {
              key,
              value: String(value.floatValue),
              numericValue: value.floatValue,
            },
      ),
    }));
}

// A WIDTH×HEIGHT frame of a fill under the sample's logo mask, read at
// `points`, in fractions from the top-left.
async function renderLogoMask(page: Page, points: Array<[number, number]>) {
  return page.evaluate(
    async ({ effects, points, width, height }) => {
      // Variables keep TypeScript from resolving the dev server's paths.
      const playerPath = "/src/CompositionPlayer.tsx";
      const maskPath = "/src/fx/effects/shape/custom-mask.ts";
      const [{ CompositionRenderer }, { setShapeImageMedia }] =
        await Promise.all([
          import(/* @vite-ignore */ playerPath),
          import(/* @vite-ignore */ maskPath),
        ]);
      const media = {
        id: "zvid-sample:opening-v2:zvid-logo",
        name: "zvid-logo.svg",
        kind: "image",
        durationSeconds: 0,
        hasAudio: false,
        hasVideo: false,
        color: "#000",
        accent: "#fff",
        previewUrl: "/samples/opening-v2/zvid-logo.svg",
        availability: "ready",
      };
      setShapeImageMedia([media]);
      const canvas = document.createElement("canvas");
      const renderer = new CompositionRenderer(
        {
          mediaItems: [media],
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
          canvasWidth: width,
          canvasHeight: height,
        },
        { canvas, audioAnalysis: "offline" },
      );
      try {
        // An exact frame waits for the SVG.
        await renderer.renderFrameAt(1, 0.5);
        const gl = canvas.getContext("webgl");
        if (!gl) throw new Error("WebGL is unavailable.");
        return points.map(([x, y]) => {
          const pixel = new Uint8Array(4);
          // readPixels counts rows from the bottom.
          gl.readPixels(
            Math.floor(x * width),
            height - 1 - Math.floor(y * height),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixel,
          );
          return Array.from(pixel);
        });
      } finally {
        renderer.destroy();
        setShapeImageMedia([]);
      }
    },
    { effects: holdEffects(), points, width: WIDTH, height: HEIGHT },
  ) as Promise<Rgba[]>;
}

const isLit = ([red]: Rgba) => red > 200;
const isDark = ([red]: Rgba) => red < 25;

// A point of the logo's viewBox (-8 -8 258 212) as a fraction of the frame,
// under the hold's box: 90% of the frame's height, in the logo's aspect,
// centered.
function logoPoint(x: number, y: number): [number, number] {
  const boxHeight = 0.9 * 1080;
  const boxWidth = (boxHeight * 258) / 212;
  return [
    (960 - boxWidth / 2 + ((x + 8) / 258) * boxWidth) / 1920,
    (540 - boxHeight / 2 + ((y + 8) / 212) * boxHeight) / 1080,
  ];
}

test.describe("the opening sample's logo mask", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/export-smoke.html");
  });

  test("keeps the shot inside the logo and clears it outside", async ({
    page,
  }) => {
    const inside = [
      logoPoint(114, 97), // the Z's diagonal
      logoPoint(120, 44), // the top strip, under its sprocket holes
      logoPoint(100, 152), // the bottom strip, above its sprocket holes
    ];
    const outside = [
      logoPoint(133, 26), // a top sprocket hole
      logoPoint(121, 169), // a bottom sprocket hole
      logoPoint(30, 100), // left of the diagonal, between the strips
      [0.05, 0.5],
      [0.95, 0.5],
      [0.5, 0.02],
    ] as Array<[number, number]>;
    const pixels = await renderLogoMask(page, [...inside, ...outside]);
    inside.forEach((point, index) => {
      expect(isLit(pixels[index]), `${point} inside`).toBe(true);
    });
    outside.forEach((point, index) => {
      expect(isDark(pixels[inside.length + index]), `${point} outside`).toBe(
        true,
      );
    });
  });
});

// A point of the logo's viewBox as a fraction of an image box the logo is
// contained in.
function containedLogoPoint(
  box: { width: number; height: number },
  x: number,
  y: number,
): [number, number] {
  const scale = Math.min(box.width / 258, box.height / 212);
  const left = (box.width - 258 * scale) / 2;
  const top = (box.height - 212 * scale) / 2;
  return [
    (left + (x + 8) * scale) / box.width,
    (top + (y + 8) * scale) / box.height,
  ];
}

// The pixels of a PNG screenshot at `points`, in fractions from the
// top-left.
async function screenshotPixels(
  page: Page,
  png: Buffer,
  points: Array<[number, number]>,
) {
  return page.evaluate(
    async ({ data, points }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas is unavailable.");
      context.drawImage(bitmap, 0, 0);
      return points.map(([x, y]) =>
        Array.from(
          context.getImageData(
            Math.floor(x * bitmap.width),
            Math.floor(y * bitmap.height),
            1,
            1,
          ).data,
        ),
      );
    },
    { data: png.toString("base64"), points },
  ) as Promise<Rgba[]>;
}

test("the Media drawer's thumbnail of the sample logo stands out on its checkerboard", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/?sample=1");
  await expect(page.getByText("Media linked")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Media", exact: true }).click();
  const image = page
    .getByRole("complementary", { name: "Media" })
    .getByRole("option")
    .filter({ hasText: "zvid-logo.svg" })
    .locator(".media-thumb__image");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const box = await image.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const inside = [
    containedLogoPoint(box, 114, 97), // the Z's diagonal
    containedLogoPoint(box, 120, 44), // the top strip
    containedLogoPoint(box, 100, 152), // the bottom strip
  ];
  const outside = [containedLogoPoint(box, 30, 100)]; // between the strips
  const pixels = await screenshotPixels(page, await image.screenshot(), [
    ...inside,
    ...outside,
  ]);
  const luma = ([red, green, blue]: Rgba) =>
    0.299 * red + 0.587 * green + 0.114 * blue;
  inside.forEach((point, index) => {
    expect(luma(pixels[index]), `${point} inside`).toBeLessThan(80);
  });
  outside.forEach((point, index) => {
    expect(
      luma(pixels[inside.length + index]),
      `${point} outside`,
    ).toBeGreaterThan(200);
  });
});
