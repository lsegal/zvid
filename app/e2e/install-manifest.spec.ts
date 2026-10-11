import { expect, type Page, test } from "@playwright/test";

// The web app is installable (#1182): its manifest meets Chrome's install
// criteria, every icon loads at its declared size, and the theme color
// matches the top of the app shell so an installed window's title bar
// blends into the top bar.

type ManifestIcon = { src: string; sizes: string; purpose: string };

type Manifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
};

async function readManifest(page: Page) {
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const response = await page.request.get(href ?? "");
  expect(response.ok()).toBe(true);
  return (await response.json()) as Manifest;
}

// The rendered color of the pixel at (x, y), as #rrggbb.
async function pixelAt(page: Page, x: number, y: number) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    context?.drawImage(bitmap, 0, 0);
    const [r, g, b] = context?.getImageData(0, 0, 1, 1).data ?? [];
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }, Array.from(png));
}

function channels(hex: string) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

function expectCloseColor(actual: string, expected: string) {
  const a = channels(actual);
  channels(expected).forEach((value, i) => {
    expect(Math.abs(a[i] - value), `${actual} vs ${expected}`).toBeLessThan(4);
  });
}

// Headless Chromium never fetches the manifest, so CDP's installability
// check reports nothing either way; this checks Chrome's criteria directly.
test("manifest meets Chrome's install criteria", async ({ page }) => {
  await page.goto("/");
  const manifest = await readManifest(page);
  expect(manifest).toMatchObject({
    name: "zvid",
    short_name: "zvid",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  const anySizes = manifest.icons
    .filter((icon) => icon.purpose === "any")
    .map((icon) => icon.sizes);
  expect(anySizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
});

test("manifest icons load at their declared sizes", async ({ page }) => {
  await page.goto("/");
  const manifest = await readManifest(page);
  const purposes = manifest.icons.map((icon) => icon.purpose);
  expect(purposes).toContain("any");
  expect(purposes).toContain("maskable");

  const appleTouch = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  const icons = [
    ...manifest.icons,
    { src: appleTouch ?? "", sizes: "180x180", purpose: "any" },
  ];
  for (const icon of icons) {
    const size = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return `${image.naturalWidth}x${image.naturalHeight}`;
    }, icon.src);
    expect(size, icon.src).toBe(icon.sizes);
  }
});

test("theme and background colors match the app surface", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No source media yet")).toBeVisible();
  const manifest = await readManifest(page);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    manifest.theme_color,
  );
  // The top-left corner sits outside the shell's centered highlight.
  expectCloseColor(await pixelAt(page, 0, 0), manifest.theme_color);
  const pageBackground = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  const [r, g, b] = pageBackground.match(/\d+/g)?.map(Number) ?? [];
  expectCloseColor(
    `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    manifest.background_color,
  );
});
