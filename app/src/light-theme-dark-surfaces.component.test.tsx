import { afterEach, describe, expect, test } from "vitest";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "./component-test/editor.tsx";
import { applyTheme, type Theme } from "./theme.ts";

// The light theme keeps headers and source tracks dark (#1492): the track
// header column (layer, Audio, source track and section headers), source
// track rows and FX device titles take the dark palette, with the dark
// theme's ink on them. Everything else still follows the light theme.

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

function accent(selector: string) {
  return getComputedStyle(query(selector))
    .getPropertyValue("--lane-selected-accent")
    .trim();
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

describe("light theme dark surfaces", () => {
  test(
    "headers and source tracks keep the dark theme's surfaces and ink",
    async () => {
      await renderIn("dark");
      const dark = Object.fromEntries(
        Object.entries(HEADERS).map(([name, selector]) => [
          name,
          colors(selector),
        ]),
      );
      const darkInk = colors(".track-row--source").ink;
      const darkAccent = accent(".track-label--lane");

      applyTheme("light");
      for (const [name, selector] of Object.entries(HEADERS)) {
        const light = colors(selector);
        expect(light, name).toEqual(dark[name]);
        expect(luminance(light.background), name).toBeLessThan(0.05);
        expect(contrast(light.ink, light.background), name).toBeGreaterThan(7);
      }
      // Source tracks and section headers sit on the dark timeline surface.
      for (const selector of [".track-row--source", ".source-header"]) {
        const light = colors(selector);
        expect(light.ink, selector).toBe(darkInk);
        expect(luminance(light.background), selector).toBeLessThan(0.05);
        expect(getComputedStyle(query(selector)).colorScheme).toBe("dark");
      }
      // The selected row's accent is the dark theme's amber, too.
      expect(accent(".track-label--lane")).toBe(darkAccent);
    },
    EDITOR_TEST_TIMEOUT,
  );

  test(
    "FX device titles get a dark surface in the light theme only",
    async () => {
      await renderIn("dark");
      const title = ".fx-device-panel__title";
      expect(channels(colors(title).background)[3]).toBe(0);

      applyTheme("light");
      const { background, ink } = colors(title);
      expect(luminance(background)).toBeLessThan(0.05);
      expect(contrast(ink, background)).toBeGreaterThan(7);
    },
    EDITOR_TEST_TIMEOUT,
  );

  test(
    "the rest of the light theme stays light",
    async () => {
      await renderIn("light");
      const ink = getComputedStyle(document.documentElement).color;
      expect(luminance(ink)).toBeLessThan(0.05);
      for (const selector of [
        '[data-layer-row-id="1"] .track-row__content',
        ".fx-device-panel",
      ]) {
        expect(getComputedStyle(query(selector)).color, selector).toBe(ink);
      }
      expect(getComputedStyle(query(".fx-device-panel")).colorScheme).toBe(
        "light",
      );
    },
    EDITOR_TEST_TIMEOUT,
  );
});
