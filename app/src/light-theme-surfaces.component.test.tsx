import { afterEach, describe, expect, test } from "vitest";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "./component-test/editor.tsx";
import { applyTheme, type Theme } from "./theme.ts";

// In the light theme, the track header column and FX device titles follow the
// theme (#1563). Source track lanes keep the dark palette (#1492).

const HEADERS = {
  "layer header": ".track-label--lane",
  "ruler header": ".ruler-row .track-label--header",
  "Audio header": ".track-row--bus .track-label",
  "source tracks header": ".source-header .track-label--header",
  "source track header": ".track-row--source .track-label",
};

afterEach(() => applyTheme("dark"));

function query(selector: string) {
  const element = document.querySelector(selector);
  expect(element, selector).not.toBeNull();
  return element as HTMLElement;
}

// A computed color as [r, g, b, a] channels, through a canvas so color() and
// color-mix() values read the same as rgb() ones.
function channels(color: string) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
}

function luminance(color: string) {
  const [r, g, b] = channels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function colors(selector: string) {
  const style = getComputedStyle(query(selector));
  return { background: style.backgroundColor, ink: style.color };
}

async function renderIn(theme: Theme) {
  applyTheme(theme);
  await renderEditor({ project: withTestPatternTrack() });
  await expect
    .poll(() => document.querySelector(".track-row--source"))
    .not.toBeNull();
  await expect
    .poll(() => document.querySelector(".fx-device-panel__title"))
    .not.toBeNull();
}

describe("light theme surfaces", () => {
  test(
    "headers are light and readable",
    async () => {
      await renderIn("light");
      for (const [name, selector] of Object.entries(HEADERS)) {
        const { background, ink } = colors(selector);
        expect(luminance(background), name).toBeGreaterThan(0.5);
        expect(contrast(ink, background), name).toBeGreaterThan(7);
      }
    },
    EDITOR_TEST_TIMEOUT,
  );

  test(
    "source track lanes stay dark beside their light labels",
    async () => {
      await renderIn("light");
      const lane = ".track-row__content--source";
      expect(getComputedStyle(query(lane)).colorScheme).toBe("dark");
      expect(luminance(colors(".track-row--source").background)).toBeLessThan(
        0.05,
      );
      expect(getComputedStyle(query(".track-label--source")).colorScheme).toBe(
        "light",
      );
    },
    EDITOR_TEST_TIMEOUT,
  );

  test(
    "the loop strip and Audio lane are light but not white",
    async () => {
      await renderIn("light");
      const scrubArea = luminance(colors(".ruler-row__content").background);
      for (const selector of [".ruler-loop-strip", ".track-row--bus"]) {
        const { background, ink } = colors(selector);
        // Darker than the ruler's scrub area, which is itself off-white, but
        // still a light surface with the light theme's ink.
        expect(luminance(background), selector).toBeLessThan(scrubArea);
        expect(luminance(background), selector).toBeGreaterThan(0.5);
        expect(contrast(ink, background), selector).toBeGreaterThan(7);
      }
    },
    EDITOR_TEST_TIMEOUT,
  );

  test(
    "FX device titles follow the theme",
    async () => {
      await renderIn("light");
      const title = ".fx-device-panel__title";
      const { ink } = colors(title);
      expect(ink).toBe(getComputedStyle(document.documentElement).color);
      expect(getComputedStyle(query(title)).colorScheme).toBe("light");
      const power = '.fx-device-panel__power[aria-pressed="true"]';
      expect(contrast(colors(power).ink, "#fff")).toBeGreaterThan(4.5);
    },
    EDITOR_TEST_TIMEOUT,
  );
});
