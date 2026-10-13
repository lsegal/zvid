// Draws a Lottie animation's frames with lottie-web's canvas renderer. The
// player draws into one working canvas and each frame is copied out into
// its own, so a texture holding an older frame is never redrawn in place.
// The player library loads on first use.

import type { AnimationItem } from "lottie-web";
import { type LottieData, lottieFrameCount, parseLottie } from "./lottie.ts";

// Drawn frames kept per animation, least recently used dropped first.
const KEPT_FRAMES = 8;

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

/**
 * A player for the Lottie animation at `url`, or undefined when it doesn't
 * hold one.
 */
export async function openLottie(
  url: string,
): Promise<LottiePlayer | undefined> {
  const data = parseLottie(await (await fetch(url)).text());
  if (!data) {
    return undefined;
  }
  const { default: lottie } = await import(
    "lottie-web/build/player/lottie_light_canvas"
  );
  const width = Math.round(data.w);
  const height = Math.round(data.h);
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const context = work.getContext("2d");
  if (!context) {
    return undefined;
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
      canvas.width = width;
      canvas.height = height;
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
