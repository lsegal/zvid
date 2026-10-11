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

// The thumbnail's pixels at `points`, in fractions from the top-left, as
// the browser draws its image `object-fit: contain` over `backdrop`. Paints
// in a canvas rather than taking a screenshot: test files share one page,
// where an element screenshot scrolls and waits on the other files' frames.
function paintedPixels(
  image: HTMLImageElement,
  backdrop: string,
  points: Array<[number, number]>,
) {
  const { width, height } = image.getBoundingClientRect();
  const canvas = new OffscreenCanvas(Math.round(width), Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable.");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(
    canvas.width / image.naturalWidth,
    canvas.height / image.naturalHeight,
  );
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    (canvas.width - drawnWidth) / 2,
    (canvas.height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
  return points.map(
    ([x, y]) =>
      Array.from(
        context.getImageData(
          Math.floor(x * canvas.width),
          Math.floor(y * canvas.height),
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
    // Waits for the SVG to load; it rejects if it can't.
    await image.decode();
    expect(image.naturalWidth).toBeGreaterThan(0);
    const box = image.getBoundingClientRect();

    const inside = [
      containedLogoPoint(box, 114, 97), // the Z's diagonal
      containedLogoPoint(box, 120, 44), // the top strip
      containedLogoPoint(box, 100, 152), // the bottom strip
    ];
    const outside = [containedLogoPoint(box, 30, 100)]; // between the strips
    // The image sits on the checkerboard, contained in its box.
    const style = getComputedStyle(image);
    expect(style.objectFit).toBe("contain");
    const checkers = style.backgroundImage.match(/rgb\([^)]*\)/g) ?? [];
    expect(style.backgroundImage).toContain("repeating-conic-gradient");
    expect(new Set(checkers).size).toBe(2);
    const luma = ([red, green, blue]: Rgba) =>
      0.299 * red + 0.587 * green + 0.114 * blue;
    // Whichever square a point falls on.
    for (const checker of new Set(checkers)) {
      const pixels = paintedPixels(image, checker, [...inside, ...outside]);
      inside.forEach((point, index) => {
        expect(
          luma(pixels[index]),
          `${point} inside on ${checker}`,
        ).toBeLessThan(80);
      });
      outside.forEach((point, index) => {
        expect(
          luma(pixels[inside.length + index]),
          `${point} outside on ${checker}`,
        ).toBeGreaterThan(200);
      });
    }
  });
});
