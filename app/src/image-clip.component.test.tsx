import { afterEach, describe, expect, test } from "vitest";
import type { ArrangementClip, Lane } from "./app/types.ts";
import { CompositionRenderer } from "./CompositionPlayer";
import { imageAnimationSeconds } from "./image-media-frames.ts";
import type { MediaItem } from "./media";

// Image clips (#1357) draw their image in exact frames, as export renders
// them: a still as it is, an animated GIF's frame at the clip's time,
// looping.

type Rgba = [number, number, number, number];

const SIZE = 64;

// A 1×1 GIF whose frames show red then blue, half a second each, looping.
function twoFrameGif() {
  const frame = (pixelData: number[]) => [
    // Graphic control: 50 hundredths of a second.
    0x21,
    0xf9,
    0x04,
    0x00,
    50,
    0x00,
    0x00,
    0x00,
    // The frame covers the whole 1×1 screen.
    0x2c,
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    // One pixel of LZW data, minimum code size 2.
    0x02,
    0x02,
    ...pixelData,
    0x00,
  ];
  return new Uint8Array([
    ...new TextEncoder().encode("GIF89a"),
    0x01,
    0x00,
    0x01,
    0x00,
    0x80,
    0x00,
    0x00,
    // The palette: red, blue.
    0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
    // Loop forever.
    0x21,
    0xff,
    0x0b,
    ...new TextEncoder().encode("NETSCAPE2.0"),
    0x03,
    0x01,
    0x00,
    0x00,
    0x00,
    ...frame([0x44, 0x01]),
    ...frame([0x4c, 0x01]),
    0x3b,
  ]);
}

async function greenPng() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable.");
  context.fillStyle = "#00ff00";
  context.fillRect(0, 0, 8, 8);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No PNG"))),
      "image/png",
    ),
  );
}

const urls: string[] = [];
afterEach(() => {
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);
});

function imageMedia(id: string, name: string, blob: Blob): MediaItem {
  const previewUrl = URL.createObjectURL(blob);
  urls.push(previewUrl);
  return {
    id,
    name,
    kind: "image",
    durationSeconds: 0,
    hasAudio: false,
    hasVideo: false,
    color: "#000",
    accent: "#fff",
    previewUrl,
    availability: "ready",
  };
}

// A clip of `media` filling Layer 1 for 4 seconds from the start.
function clipOf(media: MediaItem): ArrangementClip {
  return {
    id: `clip-${media.id}`,
    sourceSpanId: "",
    sourceTrackId: "",
    laneId: "1",
    label: media.name,
    mediaPath: media.name,
    mediaId: media.id,
    startQ: 0,
    durationSeconds: 4,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 4,
    tint: "#000",
    accent: "#fff",
  };
}

const lanes: Lane[] = [{ id: "1", name: "Layer 1", colorIndex: 0 }];

// The center pixel of the exact frame of `media` at each of `seconds`.
async function centerPixels(media: MediaItem, seconds: number[]) {
  const canvas = document.createElement("canvas");
  const renderer = new CompositionRenderer(
    {
      mediaItems: [media],
      clips: [clipOf(media)],
      lanes,
      effects: [],
      bpm: 120,
      fps: 30,
      canvasWidth: SIZE,
      canvasHeight: SIZE,
    },
    { canvas, audioAnalysis: "offline" },
  );
  try {
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL is unavailable.");
    const pixels: Rgba[] = [];
    for (const at of seconds) {
      // At 120 BPM a quarter is half a second.
      await renderer.renderFrameAt(at * 2, at);
      const pixel = new Uint8Array(4);
      gl.readPixels(SIZE / 2, SIZE / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      pixels.push(Array.from(pixel) as Rgba);
    }
    return pixels;
  } finally {
    renderer.destroy();
  }
}

const isRed = ([red, green, blue]: Rgba) =>
  red > 200 && green < 50 && blue < 50;
const isBlue = ([red, green, blue]: Rgba) =>
  blue > 200 && red < 50 && green < 50;
const isGreen = ([red, green, blue]: Rgba) =>
  green > 200 && red < 50 && blue < 50;

describe("image clips", () => {
  test("draw a still image", { timeout: 30_000 }, async () => {
    const media = imageMedia("still", "still.png", await greenPng());
    const [first, later] = await centerPixels(media, [0.1, 3]);
    expect(isGreen(first), `${first}`).toBe(true);
    expect(isGreen(later), `${later}`).toBe(true);
  });

  test("play an animated GIF's frames at the clip's time, looping", {
    timeout: 30_000,
  }, async () => {
    const gif = new Blob([twoFrameGif()], { type: "image/gif" });
    const media = imageMedia("loop", "loop.gif", gif);
    expect(
      await imageAnimationSeconds({
        previewUrl: media.previewUrl,
        name: "loop.gif",
      }),
    ).toBeCloseTo(1);
    const pixels = await centerPixels(media, [0.25, 0.75, 1.25, 1.75]);
    expect(
      pixels.map((pixel) =>
        isRed(pixel) ? "red" : isBlue(pixel) ? "blue" : `${pixel}`,
      ),
    ).toEqual(["red", "blue", "red", "blue"]);
  });
});
