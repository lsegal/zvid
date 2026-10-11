import type { CSSProperties } from "react";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { MediaItem } from "../../media";
import { MediaThumbnail } from "./MediaThumbnail";
import "./media-drawer.css";

// The opening sample's dark zvid logo (#1079) stands out on the checkerboard
// the Media drawer shows images on.

type Rgba = [number, number, number, number];

// The sample's logo, as the Media drawer lists it once linked.
const logo = {
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
} as MediaItem;

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

// The pixels of a base64 PNG screenshot at `points`, in fractions from the
// top-left.
async function screenshotPixels(data: string, points: Array<[number, number]>) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: "image/png" }),
  );
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable.");
  context.drawImage(bitmap, 0, 0);
  return points.map(
    ([x, y]) =>
      Array.from(
        context.getImageData(
          Math.floor(x * bitmap.width),
          Math.floor(y * bitmap.height),
          1,
          1,
        ).data,
      ) as Rgba,
  );
}

describe("MediaThumbnail", () => {
  test("shows the sample logo standing out on its checkerboard", async () => {
    // A tile of the drawer's icon view at its default size.
    const screen = await render(
      <div
        className="media-drawer__grid"
        style={{ "--media-tile-size": "112px" } as CSSProperties}
      >
        <div className="media-tile">
          <MediaThumbnail
            media={logo}
            mediaSync={null}
            prefersReducedMotion
            thumbnailUrl={logo.previewUrl}
          />
        </div>
      </div>,
    );
    const image = screen.container.querySelector<HTMLImageElement>(
      ".media-thumb__image",
    );
    if (!image) throw new Error("the thumbnail has no image");
    await expect.element(page.elementLocator(image)).toBeVisible();
    await expect.poll(() => image.naturalWidth).toBeGreaterThan(0);
    await image.decode();
    const box = image.getBoundingClientRect();

    const inside = [
      containedLogoPoint(box, 114, 97), // the Z's diagonal
      containedLogoPoint(box, 120, 44), // the top strip
      containedLogoPoint(box, 100, 152), // the bottom strip
    ];
    const outside = [containedLogoPoint(box, 30, 100)]; // between the strips
    const png = await page.screenshot({ element: image, save: false });
    const pixels = await screenshotPixels(png, [...inside, ...outside]);
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
});
