import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Filmstrip } from "../../app/filmstrip.ts";
import { getShortcutLabels } from "../../app/shortcut-labels.ts";
import type { SourceSpan as SourceSpanClip } from "../../app/types.ts";
import { DesktopShell } from "../../component-test/shells.tsx";
import type { MediaItem } from "../../media.ts";
import { SourceSpan, type SourceSpanContext } from "./SourceSpan";
import "./source-tracks.css";

// A source span's waveform: audio-only media draws it in place of a
// filmstrip behind a quiet border, and video with audio draws it
// semi-transparent over its frames without taking the pointer. Ported from
// audio-clip-waveform.spec.ts and video-clip-waveform.spec.ts, which keep
// the drags that need the timeline. The waveform is decoded from a WAV.
const noop = () => {};

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

const urls: string[] = [];
afterEach(() => {
  for (const url of urls.splice(0)) {
    URL.revokeObjectURL(url);
  }
});

// Ready media with the tone as its audio. Peaks are cached by media id, so
// every call makes a new one.
function media({
  hasVideo,
  hasAudio,
}: {
  hasVideo: boolean;
  hasAudio: boolean;
}) {
  const previewUrl = URL.createObjectURL(toneWav());
  urls.push(previewUrl);
  const item: MediaItem = {
    id: `media-${urls.length}-${Date.now()}`,
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

// Frames across the span, as the filmstrip cache lays them out.
function filmstripOf(item: MediaItem, widthPx: number): Filmstrip {
  const tileWidth = 96;
  return {
    media: item,
    size: { width: 96, height: 54 },
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
}

const QUARTER_PX = 40;

function spanFor(item: MediaItem): SourceSpanClip {
  return {
    id: "span-1",
    sourceTrackId: "track-1",
    label: item.name,
    mediaPath: item.name,
    mediaId: item.id,
    startQ: 2,
    durationSeconds: 3,
    trimStartSeconds: 0,
    tint: item.color,
    accent: item.accent,
  };
}

// Six quarters at 120 bpm: the span's three seconds.
const SPAN_WIDTH_PX = 6 * QUARTER_PX;

async function renderSpan(item: MediaItem, filmstrip?: Filmstrip) {
  const clip = spanFor(item);
  const context: SourceSpanContext = {
    bpm: 120,
    quarterPx: QUARTER_PX,
    visibleTimelineStartPx: 0,
    visibleTimelineWidthPx: 1000,
    mediaItemsById: new Map([[item.id, item]]),
    thumbnails: { get: () => undefined },
    spanFilmstrips: new Map(filmstrip ? [[clip.id, filmstrip]] : []),
    remoteMediaProgress: new Map(),
    prefersReducedMotion: true,
    revealedMediaIds: new Set(),
    clipMenu: null,
    selectedSourceSpanIds: new Set(),
    selectSourceSpan: noop,
    shortcutLabels: getShortcutLabels(),
    addSourceSpanToArrangement: noop,
    openSourceSpanMenu: noop,
    sourceSpanDrag: null,
    setSourceSpanDrag: noop,
    locked: false,
  };
  await render(
    <DesktopShell>
      <div
        className="track-row__content track-row__content--source"
        style={{ position: "relative", height: 82 }}
      >
        <SourceSpan clip={clip} {...context} />
      </div>
    </DesktopShell>,
  );
  return query(".source-span");
}

function query<T extends Element = HTMLElement>(selector: string) {
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

describe("an audio-only source span", () => {
  test("draws a waveform with a quiet border", {
    timeout: 30_000,
  }, async () => {
    const span = await renderSpan(media({ hasVideo: false, hasAudio: true }));
    await expect
      .poll(() => span.className, { timeout: 30_000 })
      .toContain("source-span--audio");
    await expect
      .poll(
        () => span.querySelectorAll("canvas.source-span__waveform").length,
        {
          timeout: 30_000,
        },
      )
      .toBe(1);
    expect(span.querySelectorAll(".source-span__filmstrip")).toHaveLength(0);
    await expect
      .poll(() => drawnColumns("canvas.source-span__waveform"))
      .toBeGreaterThan(20);

    // Idle: a quiet border and hidden handles.
    await userEvent.hover(document.body, { position: { x: 5, y: 5 } });
    const start = query(".source-span__handle--start");
    const end = query(".source-span__handle--end");
    await expect.poll(() => borderAlpha(span)).toBeLessThan(0.5);
    await expect.poll(() => opacity(start)).toBe("0");
    await expect.poll(() => opacity(end)).toBe("0");

    // Hover: the full border, and only the hovered handle.
    await userEvent.hover(span);
    await expect.poll(() => borderAlpha(span)).toBe(1);
    await expect.poll(() => opacity(start)).toBe("0");
    await expect.poll(() => opacity(end)).toBe("0");
    await userEvent.hover(start);
    await expect.poll(() => opacity(start)).toBe("1");
    await expect.poll(() => opacity(end)).toBe("0");
  });
});

describe("a video source span", () => {
  test("with audio draws a waveform over its filmstrip", {
    timeout: 30_000,
  }, async () => {
    const item = media({ hasVideo: true, hasAudio: true });
    const span = await renderSpan(item, filmstripOf(item, SPAN_WIDTH_PX));
    expect(span.querySelectorAll(".source-span__filmstrip")).toHaveLength(1);
    const selector = "canvas.source-span__waveform-overlay";
    await expect
      .poll(() => span.querySelectorAll(selector).length, { timeout: 30_000 })
      .toBe(1);
    expect(span.className).not.toContain("source-span--audio");
    await expect.poll(() => drawnColumns(selector)).toBeGreaterThan(20);
    const overlay = query(selector);
    expect(Number(opacity(overlay))).toBeLessThan(1);
    expect(hitAtCenter(overlay)).not.toContain("waveform-overlay");
  });

  test("without audio keeps its filmstrip and border, and draws no waveform", {
    timeout: 30_000,
  }, async () => {
    const item = media({ hasVideo: true, hasAudio: false });
    const span = await renderSpan(item, filmstripOf(item, SPAN_WIDTH_PX));
    expect(span.querySelectorAll(".source-span__filmstrip")).toHaveLength(1);
    // Give a decode the time it would need before checking nothing appeared.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(span.className).not.toContain("source-span--audio");
    expect(span.className).not.toContain("source-span--waveform-overlay");
    expect(span.querySelectorAll("canvas")).toHaveLength(0);
  });
});
