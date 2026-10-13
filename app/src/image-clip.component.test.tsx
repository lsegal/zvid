import { afterEach, describe, expect, test } from "vitest";
import { PALETTE } from "./app/constants.ts";
import type { ArrangementClip, Lane } from "./app/types.ts";
import { CompositionRenderer } from "./CompositionPlayer";
import { analyzeMediaSelection } from "./harness/web-media.ts";
import { imageAnimationSeconds, imageFrameAt } from "./image-media-frames.ts";
import type { MediaItem } from "./media";
import { writeZip } from "./zip-test-utils.ts";

// Image clips (#1357) draw their image in exact frames, as export renders
// them: a still as it is, an animated GIF's, Lottie's (#1365) or dotLottie's
// (#1367) frame at the clip's time, looping.

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

// A layer covering the 64×64 Lottie from frame `ip` to `op`.
function layer(index: number, ip: number, op: number) {
  const still = (k: unknown) => ({ a: 0, k });
  return {
    ddd: 0,
    ind: index,
    ip,
    op,
    st: 0,
    sr: 1,
    bm: 0,
    ks: {
      o: still(100),
      r: still(0),
      p: still([0, 0, 0]),
      a: still([0, 0, 0]),
      s: still([100, 100, 100]),
    },
  };
}

// A solid layer of `color` covering the 64×64 Lottie from frame `ip` to
// `op`.
function solidLayer(index: number, color: string, ip: number, op: number) {
  return {
    ...layer(index, ip, op),
    ty: 1,
    nm: color,
    sc: color,
    sw: SIZE,
    sh: SIZE,
  };
}

// A 64×64 Lottie at 30 fps that shows red for half a second, then blue.
function redThenBlueLottie() {
  return JSON.stringify({
    v: "5.7.0",
    fr: 30,
    ip: 0,
    op: 30,
    w: SIZE,
    h: SIZE,
    nm: "red then blue",
    ddd: 0,
    assets: [],
    layers: [solidLayer(1, "#ff0000", 0, 15), solidLayer(2, "#0000ff", 15, 30)],
  });
}

// A dotLottie archive whose animation, listed second in its manifest after
// one it doesn't hold, shows a red PNG image asset for half a second, then
// blue. The asset is marked embedded but names its file, as some exporters
// write them (#1373).
async function redThenBlueDotLottie() {
  const red = new Uint8Array(
    await (await solidPng("#ff0000", SIZE)).arrayBuffer(),
  );
  const animation = JSON.stringify({
    ...JSON.parse(redThenBlueLottie()),
    assets: [
      { id: "image_0", w: SIZE, h: SIZE, u: "/images/", p: "red.png", e: 1 },
    ],
    layers: [
      { ...layer(1, 0, 15), ty: 2, nm: "red", refId: "image_0" },
      solidLayer(2, "#0000ff", 15, 30),
    ],
  });
  return writeZip([
    {
      name: "manifest.json",
      data: JSON.stringify({
        version: "1",
        animations: [{ id: "missing" }, { id: "spinner" }],
      }),
    },
    { name: "animations/spinner.json", data: animation, deflate: true },
    { name: "images/red.png", data: red },
  ]);
}

async function solidPng(color: string, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable.");
  context.fillStyle = color;
  context.fillRect(0, 0, size, size);
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
    const media = imageMedia(
      "still",
      "still.png",
      await solidPng("#00ff00", 8),
    );
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

  test("import a Lottie and play its frames at the clip's time, looping", {
    timeout: 30_000,
  }, async () => {
    // A session is JSON too, but no Lottie, so it imports offline.
    const [lottie, session] = await analyzeMediaSelection(
      {
        kind: "files",
        files: [
          new File([redThenBlueLottie()], "spinner.json", {
            type: "application/json",
          }),
          new File([JSON.stringify({ bpm: 120, tracks: [] })], "set.json", {
            type: "application/json",
          }),
        ],
      },
      PALETTE,
      0,
    );
    urls.push(lottie.previewUrl, session.previewUrl);
    if (lottie.thumbnailUrl) urls.push(lottie.thumbnailUrl);
    expect(lottie).toMatchObject({
      kind: "image",
      container: "Lottie",
      width: SIZE,
      height: SIZE,
      availability: "ready",
    });
    expect(lottie.durationSeconds).toBeCloseTo(1);
    expect(lottie.thumbnailUrl).toBeTruthy();
    expect(session).toMatchObject({
      availability: "offline",
      lastError: "Not a Lottie animation",
    });

    const pixels = await centerPixels(lottie, [0.25, 0.75, 1.25, 1.75]);
    expect(
      pixels.map((pixel) =>
        isRed(pixel) ? "red" : isBlue(pixel) ? "blue" : `${pixel}`,
      ),
    ).toEqual(["red", "blue", "red", "blue"]);
  });

  test("draw a small Lottie's frames larger than its own size", {
    timeout: 30_000,
  }, async () => {
    // Shapes stretched from a 64×64 frame would look blocky (#1373).
    const media = imageMedia(
      "small",
      "small.json",
      new Blob([redThenBlueLottie()], { type: "application/json" }),
    );
    const ref = { previewUrl: media.previewUrl, name: media.name };
    await imageAnimationSeconds(ref);
    const frame = imageFrameAt(ref, 0.25);
    expect(frame).toMatchObject({ width: SIZE, height: SIZE });
    const image = frame?.image as HTMLCanvasElement;
    expect([image.width, image.height]).toEqual([1920, 1920]);
  });

  test("import a dotLottie and play its frames, image assets included", {
    timeout: 30_000,
  }, async () => {
    const lottieFile = (name: string, data: BlobPart) =>
      new File([data], name, { type: "application/zip" });
    const [lottie, broken, plain, empty] = await analyzeMediaSelection(
      {
        kind: "files",
        files: [
          lottieFile("spinner.lottie", await redThenBlueDotLottie()),
          lottieFile("broken.lottie", "not a zip"),
          lottieFile("plain.lottie", redThenBlueLottie()),
          lottieFile(
            "empty.lottie",
            await writeZip([{ name: "manifest.json", data: "{}" }]),
          ),
        ],
      },
      PALETTE,
      0,
    );
    urls.push(
      lottie.previewUrl,
      broken.previewUrl,
      plain.previewUrl,
      empty.previewUrl,
    );
    if (plain.thumbnailUrl) urls.push(plain.thumbnailUrl);
    if (lottie.thumbnailUrl) urls.push(lottie.thumbnailUrl);
    expect(lottie).toMatchObject({
      kind: "image",
      container: "Lottie",
      width: SIZE,
      height: SIZE,
      availability: "ready",
    });
    expect(lottie.durationSeconds).toBeCloseTo(1);
    expect(lottie.thumbnailUrl).toBeTruthy();
    expect(broken).toMatchObject({
      availability: "offline",
      lastError: "Not a dotLottie archive",
    });
    // A plain Lottie JSON file named .lottie plays too.
    expect(plain).toMatchObject({ container: "Lottie", availability: "ready" });
    expect(empty).toMatchObject({
      availability: "offline",
      lastError: "No animation in the dotLottie archive",
    });

    const pixels = await centerPixels(lottie, [0.25, 0.75, 1.25, 1.75]);
    expect(
      pixels.map((pixel) =>
        isRed(pixel) ? "red" : isBlue(pixel) ? "blue" : `${pixel}`,
      ),
    ).toEqual(["red", "blue", "red", "blue"]);
  });
});
