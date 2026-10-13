// Draws a Lottie animation's frames with lottie-web's canvas renderer. The
// player draws into one working canvas and each frame is copied out into
// its own, so a texture holding an older frame is never redrawn in place.
// The player library loads on first use.

import type { AnimationItem } from "lottie-web";
import {
  isDotLottieName,
  type LottieFile,
  readDotLottie,
} from "./dotlottie.ts";
import { type LottieData, lottieFrameCount, parseLottie } from "./lottie.ts";

// Drawn frames kept per animation, least recently used dropped first.
const KEPT_FRAMES = 8;

// The shortest long edge, in pixels, frames are drawn at. Animations are
// mostly vector shapes, so a small one draws sharp at this size rather than
// being stretched from its own.
const MIN_DRAWN_EDGE = 1920;

export type LottiePlayer = {
  data: LottieData;
  width: number;
  height: number;
  /** The canvas showing frame `index`, drawn now unless it is kept. */
  frame(index: number): HTMLCanvasElement;
};

function waitForLoad(animation: AnimationItem) {
  return new Promise<void>((resolve, reject) => {
    if (animation.isLoaded) {
      resolve();
      return;
    }
    animation.addEventListener("DOMLoaded", () => resolve());
    animation.addEventListener("data_failed", () =>
      reject(new Error("The Lottie animation failed to load.")),
    );
  });
}

// The Lottie animation in the file `name` at `url`, or why it holds none.
async function readLottie(url: string, name: string): Promise<LottieFile> {
  const response = await fetch(url);
  if (isDotLottieName(name)) {
    return readDotLottie(new Uint8Array(await response.arrayBuffer()));
  }
  const data = parseLottie(await response.text());
  return data ? { data } : { error: "Not a Lottie animation" };
}

/**
 * A player for the Lottie animation in the file `name` at `url`. It throws
 * the reason when the file holds none.
 */
export async function openLottie(
  url: string,
  name: string,
): Promise<LottiePlayer> {
  const file = await readLottie(url, name);
  if ("error" in file) {
    throw new Error(file.error);
  }
  const { data } = file;
  const { default: lottie } = await import(
    "lottie-web/build/player/lottie_light_canvas"
  );
  const width = Math.round(data.w);
  const height = Math.round(data.h);
  const scale = Math.max(1, MIN_DRAWN_EDGE / Math.max(width, height, 1));
  const work = document.createElement("canvas");
  work.width = Math.round(width * scale);
  work.height = Math.round(height * scale);
  const context = work.getContext("2d");
  if (!context) {
    throw new Error("2D canvas is unavailable");
  }
  const animation = lottie.loadAnimation({
    renderer: "canvas",
    animationData: data,
    autoplay: false,
    loop: false,
    rendererSettings: { context, clearCanvas: true, dpr: 1 },
  } as Parameters<typeof lottie.loadAnimation>[0]);
  await waitForLoad(animation);
  const frames = new Map<number, HTMLCanvasElement>();
  const count = lottieFrameCount(data);
  return {
    data,
    width,
    height,
    frame(index) {
      const at = Math.min(Math.max(0, Math.floor(index)), count - 1);
      const kept = frames.get(at);
      if (kept) {
        frames.delete(at);
        frames.set(at, kept);
        return kept;
      }
      animation.goToAndStop(at, true);
      const canvas = document.createElement("canvas");
      canvas.width = work.width;
      canvas.height = work.height;
      canvas.getContext("2d")?.drawImage(work, 0, 0);
      frames.set(at, canvas);
      for (const oldIndex of frames.keys()) {
        if (frames.size <= KEPT_FRAMES) {
          break;
        }
        frames.delete(oldIndex);
      }
      return canvas;
    },
  };
}

/** A PNG of `player`'s frame `index`, as an object URL. */
export async function lottieFrameUrl(player: LottiePlayer, index: number) {
  const canvas = player.frame(index);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  return blob ? URL.createObjectURL(blob) : undefined;
}
