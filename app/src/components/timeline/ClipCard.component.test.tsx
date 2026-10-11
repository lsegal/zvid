import { afterEach, describe, expect, test } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-react";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import type { ArrangementClip } from "../../app/types.ts";
import { emulateTouch } from "../../component-test/viewport.ts";
import { addFxClip } from "../../fx-clip.ts";
import type { SessionEffect } from "../../fx-stack.ts";
import { addTextClip } from "../../text-clip.ts";
import { ClipCard, type ClipCardContext } from "./ClipCard";

const noop = () => {};

const clip: ArrangementClip = {
  id: "clip-1",
  kind: "fill",
  sourceSpanId: "span-1",
  sourceTrackId: "track-1",
  laneId: "lane-1",
  label: "Intro",
  mediaPath: "",
  startQ: 0,
  durationSeconds: 2,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 2,
  tint: "#334",
  accent: "#f80",
};

const context: ClipCardContext = {
  selectedClipId: undefined,
  dragState: null,
  bpm: 120,
  quarterPx: 40,
  visibleTimelineStartPx: 0,
  visibleTimelineWidthPx: 1000,
  signature: { id: "sig-1", numerator: 4, denominator: 4 },
  mediaItemsById: new Map(),
  thumbnails: { get: () => undefined },
  clipPieces: new Map(),
  clipFilmstrips: new Map(),
  remoteMediaProgress: new Map(),
  timelineEffects: [],
  effects: [],
  prefersReducedMotion: true,
  revealedMediaIds: new Set(),
  shortcutLabels: getShortcutLabels(),
  openArrangementClipMenu: noop,
  startTextEdit: noop,
  setPendingSelection: noop,
  setDragPreviewClips: noop,
  setSelectedClipId: noop,
  setDragState: noop,
};

function renderClipCard(
  card: ArrangementClip = clip,
  overrides: Partial<ClipCardContext> = {},
) {
  return render(<ClipCard clip={card} {...context} {...overrides} />);
}

describe("ClipCard", () => {
  test("is styled by clip-card.css", async () => {
    const screen = await renderClipCard();
    const card = screen.container.querySelector(".clip-card");
    expect(card).not.toBeNull();
    const style = getComputedStyle(card as Element);
    expect(style.position).toBe("absolute");
    expect(style.borderTopLeftRadius).toBe("9px");
    expect(style.display).toBe("grid");
  });

  test("shows its trim handles only on hover with a mouse", async () => {
    const screen = await renderClipCard();
    const handle = screen.container.querySelector(".clip-card__handle");
    expect(getComputedStyle(handle as Element).opacity).toBe("0");
  });

  // Touch has no hover to reveal them, so they always show.
  test("always shows its trim handles on a touch screen", async () => {
    await emulateTouch();
    const screen = await renderClipCard();
    const handle = screen.container.querySelector(".clip-card__handle");
    expect(matchMedia("(hover: none)").matches).toBe(true);
    expect(getComputedStyle(handle as Element).opacity).toBe("1");
  });
});

// Narrow Text and FX clips keep their "T" / "FX" glyph at full width and let
// the label give way, so they look like a wide clip cut off on the right.
describe("ClipCard glyph on a narrow clip", () => {
  const clipOptions = {
    laneId: "lane-1",
    startQ: 0,
    durationQ: 8,
    bpm: 120,
    tint: "#2a2d38",
    accent: "#8d93a8",
  };
  const text = addTextClip(
    { clips: [], effects: [] as SessionEffect[] },
    { ...clipOptions, id: "text-1", effectId: "text-effect-1" },
  );
  const fx = addFxClip({ clips: [] }, { ...clipOptions, id: "fx-1" });

  // Squeezes the clip to `width` pixels, as a short clip or a far zoom-out
  // would, and returns the glyph and label boxes relative to the clip.
  function layoutAt(element: HTMLElement, width: number) {
    element.style.width = `${width}px`;
    const clipBox = element.getBoundingClientRect();
    const glyph = element.querySelector(".clip-card__glyph");
    const label = element.querySelector(".clip-card__text strong");
    if (!glyph || !label) {
      throw new Error("Clip has no glyph or label");
    }
    const glyphBox = glyph.getBoundingClientRect();
    return {
      glyphLeft: glyphBox.left - clipBox.left,
      glyphWidth: glyphBox.width,
      labelWidth: label.getBoundingClientRect().width,
    };
  }

  for (const { kind, card, effects, glyph } of [
    { kind: "text", card: text.clip, effects: text.effects, glyph: "T" },
    { kind: "fx", card: fx.clip, effects: [], glyph: "FX" },
  ]) {
    test(`a narrow ${kind} clip keeps its ${glyph} glyph at full width`, async () => {
      const screen = await renderClipCard(card, {
        timelineEffects: effects,
        effects,
      });
      const element = screen.container.querySelector<HTMLElement>(
        `.clip-card--${kind}`,
      );
      if (!element) {
        throw new Error(`No ${kind} clip`);
      }
      expect(element.querySelector(".clip-card__glyph")?.textContent).toBe(
        glyph,
      );

      const wide = layoutAt(element, 220);
      expect(wide.glyphWidth).toBe(28);
      expect(wide.labelWidth).toBeGreaterThan(0);

      // Too narrow for the label: the glyph keeps its width at the clip's
      // start and the label is squeezed out.
      const narrow = layoutAt(element, 50);
      expect(narrow.glyphWidth).toBe(28);
      expect(narrow.glyphLeft).toBeLessThanOrEqual(1);
      expect(narrow.labelWidth).toBe(0);

      // Narrower than the glyph: the clip cuts it off rather than shrinking
      // it.
      const tiny = layoutAt(element, 20);
      expect(tiny.glyphWidth).toBe(28);

      // The start trim handle still sits over the clip's leading edge.
      layoutAt(element, 50);
      const handleBox = element
        .querySelector(".clip-card__handle--start")
        ?.getBoundingClientRect();
      const clipBox = element.getBoundingClientRect();
      if (!handleBox) {
        throw new Error("Clip has no start handle");
      }
      expect(handleBox.width).toBeGreaterThan(0);
      // Inside the clip's 1px border.
      expect(Math.abs(handleBox.x - clipBox.x)).toBeLessThanOrEqual(1);
    });
  }
});

describe("ClipCard with reduced motion", () => {
  afterEach(async () => {
    await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  });

  test("shows its trim handles without a fade", async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const screen = await renderClipCard();
    const handle = screen.container.querySelector(".clip-card__handle--start");
    expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
    expect(getComputedStyle(handle as Element).transitionDuration).toBe("0s");
  });
});
