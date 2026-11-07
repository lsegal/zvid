import { afterEach, describe, expect, test } from "vitest";
import type { ProjectState } from "./app/types.ts";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
  withTestPatternTrack,
} from "./component-test/editor.tsx";
import { applyTheme, type Theme } from "./theme.ts";

// In the light theme, the track header column, FX device titles (#1563) and
// source track lanes (#1617) follow the theme.

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

// The test pattern's track, then a track with a MIDI clip.
function withMidiClip(): ProjectState {
  const base = withTestPatternTrack();
  return {
    ...base,
    sourceTracks: [
      ...base.sourceTracks,
      { id: "keys", name: "Keys", colorIndex: 2, recordingPaths: [] },
    ],
    sourceSpans: [
      ...base.sourceSpans,
      {
        id: "midi",
        sourceTrackId: "keys",
        label: "Keys",
        mediaPath: "",
        startQ: 0,
        durationSeconds: 4,
        trimStartSeconds: 0,
        notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }],
        tint: "#1c2340",
        accent: "#7ca1ff",
      },
    ],
  };
}

async function renderIn(theme: Theme, project = withTestPatternTrack()) {
  applyTheme(theme);
  await renderEditor({ project });
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
    "source track lanes are light like layer lanes",
    async () => {
      await renderIn("light");
      const lane = ".track-row__content--source";
      expect(getComputedStyle(query(lane)).colorScheme).toBe("light");
      // The lane's own wash is translucent, so nothing dark may sit under it.
      expect(colors(".track-row--source").background).toBe("rgba(0, 0, 0, 0)");
      expect(colors(lane).background).toBe(
        colors(".track-row__content--arrangement").background,
      );
    },
    EDITOR_TEST_TIMEOUT,
  );

  test(
    "MIDI clip notes stand out on a light clip and keep the dark theme's color",
    async () => {
      const note = ".source-span__midi-note";
      const noteColor = () => colors(note).background;
      const project = withMidiClip();
      await renderIn("light", project);
      await expect.poll(() => document.querySelector(note)).not.toBeNull();
      const clip = colors('[data-source-span-id="midi"]').background;
      expect(luminance(clip)).toBeGreaterThan(0.5);
      expect(contrast(noteColor(), clip)).toBeGreaterThan(3);
      applyTheme("dark");
      await expect
        .poll(() => channels(noteColor()))
        .toEqual(channels("color-mix(in srgb, #7ca1ff 70%, white)"));
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
