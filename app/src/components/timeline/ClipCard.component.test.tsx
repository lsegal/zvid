import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { type Filmstrip, getClipPieceKey } from "../../app/filmstrip.ts";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import type { ArrangementClip } from "../../app/types.ts";
import { DesktopShell } from "../../component-test/shells.tsx";
import { emulateTouch } from "../../component-test/viewport.ts";
import type { MediaItem } from "../../media.ts";
import { ClipCard, type ClipCardContext } from "./ClipCard";
import "./lane-row.css";

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

// A clip card's waveform: audio-only media draws it in place of a filmstrip
// behind a quiet border, and video with audio draws it semi-transparent over
// its frames without taking the pointer. Ported from
// audio-clip-waveform.spec.ts and video-clip-waveform.spec.ts, which keep
// the trim and move drags that need the timeline. The waveform is decoded
// from a WAV.

// A three-second 440 Hz tone as a 16-bit mono WAV.
function toneWav() {
  const sampleRate = 8000;
  const frames = 3 * sampleRate;
  const view = new DataView(new ArrayBuffer(44 + frames * 2));
  const write = (text: string, at: number) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(at + index, text.charCodeAt(index));
    }
  };
  write("RIFF", 0);
  view.setUint32(4, view.byteLength - 8, true);
  write("WAVEfmt ", 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write("data", 36);
  view.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    view.setInt16(44 + index * 2, Math.round(sample * 16_000), true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

const mediaUrls: string[] = [];
afterEach(() => {
  for (const url of mediaUrls.splice(0)) {
    URL.revokeObjectURL(url);
  }
});

// Ready media with the tone as its audio. Peaks are cached by media id, so
// every call makes a new one.
function toneMedia({
  hasVideo,
  hasAudio,
}: {
  hasVideo: boolean;
  hasAudio: boolean;
}) {
  const previewUrl = URL.createObjectURL(toneWav());
  mediaUrls.push(previewUrl);
  const item: MediaItem = {
    id: `media-${mediaUrls.length}-${Date.now()}`,
    name: "tone.wav",
    kind: hasVideo ? "video" : "audio",
    durationSeconds: 3,
    hasAudio,
    hasVideo,
    color: "#3a6",
    accent: "#6c9",
    previewUrl,
    availability: "ready",
  };
  return item;
}

// A layer clip of the media's three seconds, as its one piece, with frames
// across it when it has a filmstrip.
async function renderMediaClip(item: MediaItem, { filmstrip = false } = {}) {
  const mediaClip: ArrangementClip = {
    ...clip,
    kind: undefined,
    label: item.name,
    mediaPath: item.name,
    mediaId: item.id,
    startQ: 2,
    durationSeconds: 3,
    sourceWindowEndSeconds: 3,
    tint: item.color,
    accent: item.accent,
  };
  const pieceKey = getClipPieceKey(mediaClip.id, 0);
  // Six quarters at 120 bpm: the clip's three seconds.
  const widthPx = 6 * context.quarterPx;
  const tileWidth = 80;
  const strip: Filmstrip = {
    media: item,
    size: { width: 80, height: 42 },
    tiles: Array.from(
      { length: Math.ceil(widthPx / tileWidth) },
      (_, index) => ({
        index,
        leftPx: index * tileWidth,
        widthPx: tileWidth,
        timeSeconds: index,
      }),
    ),
  };
  await render(
    <DesktopShell>
      <div
        className="track-row__content track-row__content--arrangement"
        style={{ position: "relative", height: 66 }}
      >
        <ClipCard
          clip={mediaClip}
          {...context}
          mediaItemsById={new Map([[item.id, item]])}
          clipPieces={new Map([[mediaClip.id, [mediaClip]]])}
          clipFilmstrips={new Map(filmstrip ? [[pieceKey, strip]] : [])}
        />
      </div>
    </DesktopShell>,
  );
  return queryElement(".clip-card");
}

function queryElement<T extends Element = HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`No ${selector}`);
  }
  return element;
}

// The alpha of an element's top border color, 0-1.
function borderAlpha(element: Element) {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) {
    throw new Error("no 2d context");
  }
  probe.fillStyle = getComputedStyle(element).borderTopColor;
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  return probe.getImageData(0, 0, 1, 1).data[3] / 255;
}

function opacity(element: Element) {
  return getComputedStyle(element).opacity;
}

// How many columns of a waveform canvas have anything drawn in them.
function drawnColumns(selector: string) {
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  const context = canvas?.getContext("2d");
  if (!canvas || !context || !canvas.width || !canvas.height) {
    return 0;
  }
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let columns = 0;
  for (let x = 0; x < canvas.width; x += 1) {
    for (let y = 0; y < canvas.height; y += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] > 0) {
        columns += 1;
        break;
      }
    }
  }
  return columns;
}

// The element the pointer would hit at the middle of an element's box.
function hitAtCenter(element: Element) {
  const box = element.getBoundingClientRect();
  return (
    document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      ?.className ?? ""
  );
}

describe("an audio-only clip card", () => {
  test("draws a waveform with a quiet border", {
    timeout: 30_000,
  }, async () => {
    const card = await renderMediaClip(
      toneMedia({ hasVideo: false, hasAudio: true }),
    );
    await expect
      .poll(() => card.className, { timeout: 30_000 })
      .toContain("clip-card--audio");
    const selector = "canvas.clip-card__waveform";
    await expect
      .poll(() => card.querySelectorAll(selector).length, { timeout: 30_000 })
      .toBe(1);
    expect(card.querySelectorAll(".clip-card__filmstrip")).toHaveLength(0);
    expect(card.querySelectorAll(".clip-card__thumb")).toHaveLength(0);
    await expect.poll(() => drawnColumns(selector)).toBeGreaterThan(20);

    // Idle: a quiet border and hidden handles.
    await userEvent.hover(document.body, { position: { x: 5, y: 5 } });
    const start = queryElement(".clip-card__handle--start");
    const end = queryElement(".clip-card__handle--end");
    await expect.poll(() => borderAlpha(card)).toBeLessThan(0.5);
    await expect.poll(() => opacity(start)).toBe("0");
    await expect.poll(() => opacity(end)).toBe("0");

    // Hover: the full border, and only the hovered handle.
    await userEvent.hover(card);
    await expect.poll(() => borderAlpha(card)).toBe(1);
    await expect.poll(() => opacity(start)).toBe("0");
    await expect.poll(() => opacity(end)).toBe("0");
    await userEvent.hover(start);
    await expect.poll(() => opacity(start)).toBe("1");
    await expect.poll(() => opacity(end)).toBe("0");
  });
});

describe("a video clip card", () => {
  test("with audio draws a waveform over its filmstrip that never takes the pointer", {
    timeout: 30_000,
  }, async () => {
    const card = await renderMediaClip(
      toneMedia({ hasVideo: true, hasAudio: true }),
      { filmstrip: true },
    );
    expect(card.querySelectorAll(".clip-card__filmstrip")).toHaveLength(1);
    const selector = "canvas.clip-card__waveform-overlay";
    await expect
      .poll(() => card.querySelectorAll(selector).length, { timeout: 30_000 })
      .toBe(1);
    expect(card.className).not.toContain("clip-card--audio");
    await expect.poll(() => drawnColumns(selector)).toBeGreaterThan(20);
    const overlay = queryElement(selector);
    expect(Number(opacity(overlay))).toBeLessThan(1);
    expect(hitAtCenter(overlay)).not.toContain("waveform-overlay");
  });

  test("without audio keeps its filmstrip and border, and draws no waveform", {
    timeout: 30_000,
  }, async () => {
    const card = await renderMediaClip(
      toneMedia({ hasVideo: true, hasAudio: false }),
      { filmstrip: true },
    );
    expect(card.querySelectorAll(".clip-card__filmstrip")).toHaveLength(1);
    // Give a decode the time it would need before checking nothing appeared.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(card.className).not.toContain("clip-card--audio");
    expect(card.className).not.toContain("clip-card--waveform-overlay");
    expect(card.querySelectorAll("canvas")).toHaveLength(0);
    await userEvent.hover(document.body, { position: { x: 5, y: 5 } });
    await expect.poll(() => borderAlpha(card)).toBe(1);
  });
});
