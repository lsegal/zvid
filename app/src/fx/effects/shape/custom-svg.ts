// The pure parts of Shape ▸ Custom's mask: making an SVG stretch over the
// box it is drawn into, and reading its opaque area from drawn pixels.

const SVG_ROOT = /<svg\b[^>]*>/i;

function readLength(tag: string, name: string) {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`,
    "i",
  ).exec(tag);
  const value = match ? Number.parseFloat(match[1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function setAttribute(tag: string, name: string, value: string) {
  const existing = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*')`, "i");
  const attribute = ` ${name}="${value}"`;
  return existing.test(tag)
    ? tag.replace(existing, attribute)
    : tag.replace(/\s*(\/?)>$/, `${attribute}$1>`);
}

/**
 * `source` with its root `<svg>` set to stretch its viewBox over any box it
 * is drawn into, as the built-in shapes stretch over the layer's box. An
 * SVG sized only by width and height gets a viewBox of that size, and one
 * sized only by its viewBox gets that width and height. Undefined
 * when `source` has no `<svg>` element.
 */
export function stretchSvgSource(source: string) {
  const match = SVG_ROOT.exec(source);
  if (!match) {
    return undefined;
  }
  let tag = match[0];
  const width = readLength(tag, "width");
  const height = readLength(tag, "height");
  const viewBox = /\sviewBox\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  if (!viewBox) {
    if (width && height) {
      tag = setAttribute(tag, "viewBox", `0 0 ${width} ${height}`);
    }
  } else if (!width || !height) {
    // Browsers only decode an SVG image with a size of its own, so one
    // sized by its viewBox alone gets the viewBox's.
    const [, , boxWidth, boxHeight] = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (boxWidth > 0 && boxHeight > 0) {
      tag = setAttribute(tag, "width", String(boxWidth));
      tag = setAttribute(tag, "height", String(boxHeight));
    }
  }
  tag = setAttribute(tag, "preserveAspectRatio", "none");
  return (
    source.slice(0, match.index) +
    tag +
    source.slice(match.index + match[0].length)
  );
}

/**
 * The mask of drawn RGBA pixels: one byte a pixel, its alpha. Only coverage
 * counts, so the SVG's fill colors make no difference.
 */
export function alphaToMask(rgba: ArrayLike<number>) {
  const mask = new Uint8Array(Math.floor(rgba.length / 4));
  for (let index = 0; index < mask.length; index++) {
    mask[index] = rgba[index * 4 + 3];
  }
  return mask;
}
