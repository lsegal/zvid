import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import type { ProjectState } from "../../app/types.ts";
import { down, move, up } from "../../component-test/cdp-mouse.ts";
import {
  renderEditor,
  sessionWithLayers,
} from "../../component-test/editor-harness.tsx";
import { setViewport } from "../../component-test/viewport.ts";
import type { MediaItem } from "../../media";
import { addMediaToSourceTrack } from "../../source-track-media.ts";
import "./LaneRow";

// Committing a selection with a number key makes a layer clip over it from
// that source track. LaneRow draws the selection and the clips; the editor
// harness wires the commit, the source tracks and the clip waveforms as App
// does.

// A 440 Hz tone as a 16-bit mono WAV.
function toneWav(seconds: number) {
  const sampleRate = 8000;
  const frames = Math.round(seconds * sampleRate);
  const wav = new DataView(new ArrayBuffer(44 + frames * 2));
  const ascii = (offset: number, text: string) => {
    for (const [index, char] of [...text].entries()) {
      wav.setUint8(offset + index, char.charCodeAt(0));
    }
  };
  ascii(0, "RIFF");
  wav.setUint32(4, wav.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  ascii(36, "data");
  wav.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.setInt16(44 + index * 2, Math.round(sample * 10_000), true);
  }
  return new Blob([wav.buffer], { type: "audio/wav" });
}

const urls: string[] = [];

// A tone of `seconds` as importing tone-<name>.wav makes it.
function tone(name: string, seconds: number): MediaItem {
  const url = URL.createObjectURL(toneWav(seconds));
  urls.push(url);
  return {
    id: `media-tone-${name}`,
    name: `tone-${name}.wav`,
    kind: "audio",
    durationSeconds: seconds,
    sampleRate: 8000,
    channels: 1,
    hasAudio: true,
    hasVideo: false,
    color: "#444351",
    accent: "#ff6f9d",
    previewUrl: url,
    availability: "ready",
  };
}

// Layer 1 and `tones` dropped together into one new source track, back to
// back.
function withTones(tones: MediaItem[]): ProjectState {
  const project = sessionWithLayers(1);
  return {
    ...project,
    mediaItems: tones,
    ...addMediaToSourceTrack(project, tones, { kind: "new-track" }),
  };
}

function lane(id: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-timeline-lane-id="${id}"]`,
  );
  if (!element) {
    throw new Error(`Layer ${id} is not rendered`);
  }
  return element;
}

// The [left, right] edges of each element, in page pixels, left to right.
function edges(elements: Iterable<Element>) {
  return [...elements]
    .map((element) => element.getBoundingClientRect())
    .map((rect) => [rect.left, rect.right])
    .toSorted((a, b) => a[0] - b[0]);
}

function selectionEdges(layer: HTMLElement) {
  return edges(layer.querySelectorAll(".timeline-selection"));
}

// Opens the session and centers Layer 1 vertically, at the song start, so
// it lines up with the source clips below it.
async function openWithTones(tones: MediaItem[]) {
  await renderEditor({ project: withTones(tones) });
  await expect
    .poll(() => document.querySelectorAll(".source-span").length)
    .toBe(tones.length);
  const layer = lane("1");
  layer.scrollIntoView({ block: "center" });
  const scroller = layer.closest(".timeline-scroll");
  if (scroller) {
    scroller.scrollLeft = 0;
  }
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  return layer;
}

// Drags a selection on `layer` from `fromX` to `toX` and commits it to
// source track 1. Returns the selection's [left, right] edges.
async function commitSelection(layer: HTMLElement, fromX: number, toX: number) {
  const y = layer.getBoundingClientRect().y + 20;
  await move(fromX, y);
  await down();
  await move(toX, y, { steps: 6 });
  await up();
  await expect.poll(() => selectionEdges(layer).length).toBe(1);
  const [selected] = selectionEdges(layer);
  await userEvent.keyboard("1");
  await expect.poll(() => selectionEdges(layer).length).toBe(0);
  return selected;
}

// How many columns of a waveform canvas have anything drawn in them.
function drawnColumns(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) {
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

describe("LaneRow committing a selection in the editor", () => {
  beforeEach(async () => {
    await setViewport({ width: 1600, height: 1200 });
  });
  afterEach(() => {
    for (const url of urls.splice(0)) {
      URL.revokeObjectURL(url);
    }
  });

  // Committing a selection over clips on a layer carves out its range, as
  // pasting or moving a clip there does: a clip it partly covers is trimmed
  // and a clip it covers is removed (#916).
  test("trims or removes the clips it covers", async () => {
    const layer = await openWithTones([tone("a", 8)]);
    const [[spanLeft, spanRight]] = edges(
      document.querySelectorAll(".source-span"),
    );
    const at = (fraction: number) =>
      spanLeft + (spanRight - spanLeft) * fraction;
    const clips = () => edges(layer.querySelectorAll(".clip-card"));

    const first = await commitSelection(layer, at(0.1), at(0.6));
    await expect.poll(() => clips().length).toBe(1);

    // Dragged right to left from empty space, over the first clip's end: the
    // first clip keeps the part before the new one.
    const second = await commitSelection(layer, at(0.9), at(0.4));
    expect(second[0]).toBeLessThan(first[1] - 10);
    await expect.poll(() => clips().length).toBe(2);
    const trimmed = clips();
    expect(Math.abs(trimmed[0][0] - first[0])).toBeLessThan(2);
    expect(Math.abs(trimmed[0][1] - second[0])).toBeLessThan(2);
    expect(Math.abs(trimmed[1][0] - second[0])).toBeLessThan(2);
    expect(Math.abs(trimmed[1][1] - second[1])).toBeLessThan(2);

    // A selection over both removes them.
    const third = await commitSelection(layer, at(0.98), at(0.02));
    await expect.poll(() => clips().length).toBe(1);
    const [only] = clips();
    expect(Math.abs(only[0] - third[0])).toBeLessThan(2);
    expect(Math.abs(only[1] - third[1])).toBeLessThan(2);
  });

  // Committing a selection that covers several clips on a source track
  // makes one layer clip for the selection, which draws each covered clip's
  // waveform, not only the first's (#817, #932).
  test("over three source clips commits one clip showing each", async () => {
    const layer = await openWithTones([
      tone("a", 2),
      tone("b", 2),
      tone("c", 2),
    ]);
    const spans = edges(document.querySelectorAll(".source-span"));
    // Back to back on one track.
    expect(spans[1][0] - spans[0][1]).toBeLessThan(2);
    expect(spans[2][0] - spans[1][1]).toBeLessThan(2);

    // From inside the first source clip to inside the last.
    const fromX = spans[0][0] + (spans[0][1] - spans[0][0]) / 4;
    const toX = spans[2][1] - (spans[2][1] - spans[2][0]) / 4;
    const [selectedLeft, selectedRight] = await commitSelection(
      layer,
      fromX,
      toX,
    );

    // One clip over the whole selection, drawing one part per source clip,
    // split at the source clip edges.
    await expect
      .poll(() => layer.querySelectorAll(".clip-card").length)
      .toBe(1);
    const [clipEdge] = edges(layer.querySelectorAll(".clip-card"));
    expect(Math.abs(clipEdge[0] - selectedLeft)).toBeLessThan(2);
    expect(Math.abs(clipEdge[1] - selectedRight)).toBeLessThan(2);
    const pieces = () => [
      ...layer.querySelectorAll<HTMLElement>(".clip-card .clip-card__piece"),
    ];
    await expect.poll(() => pieces().length).toBe(3);
    const clipEdges = edges(pieces());
    expect(Math.abs(clipEdges[0][0] - selectedLeft)).toBeLessThan(2);
    expect(Math.abs(clipEdges[0][1] - spans[0][1])).toBeLessThan(2);
    expect(Math.abs(clipEdges[1][0] - spans[1][0])).toBeLessThan(2);
    expect(Math.abs(clipEdges[1][1] - spans[1][1])).toBeLessThan(2);
    expect(Math.abs(clipEdges[2][0] - spans[2][0])).toBeLessThan(2);
    expect(Math.abs(clipEdges[2][1] - selectedRight)).toBeLessThan(2);

    // Each part draws its waveform across its whole width.
    for (let index = 0; index < 3; index += 1) {
      const waveforms = () =>
        pieces()[index].querySelectorAll<HTMLCanvasElement>(
          "canvas.clip-card__waveform",
        );
      await expect.poll(() => waveforms().length).toBe(1);
      await expect
        .poll(() => {
          const [waveform] = waveforms();
          return (
            waveform.width > 0 && drawnColumns(waveform) > waveform.width * 0.8
          );
        })
        .toBe(true);
    }
  });
});
