import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import type { ArrangementClip } from "../../app/types.ts";
import { emulateTouch } from "../../component-test/viewport.ts";
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

function renderClipCard() {
  return render(<ClipCard clip={clip} {...context} />);
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
