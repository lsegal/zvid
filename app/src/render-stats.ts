// Counts the compositor's costly work, so a regression that allocates
// render targets or rasterizes text and fills every frame shows up. Logged
// once a second to the console while `localStorage["zvid.debug.renderStats"]`
// is "1"; otherwise only counted.
export type RenderStats = {
  // Render targets (a texture and its framebuffer) created.
  targetAllocations: number;
  // Text clips laid out and drawn into their textures.
  textRasterizations: number;
  // Fill clips drawn into their textures.
  fillRasterizations: number;
};

export const RENDER_STATS_STORAGE_KEY = "zvid.debug.renderStats";

export const renderStats: RenderStats = {
  targetAllocations: 0,
  textRasterizations: 0,
  fillRasterizations: 0,
};

let logging: boolean | undefined;
let windowStart = 0;
let windowCounts: RenderStats = { ...renderStats };
let frames = 0;
let totalFrameMs = 0;
let maxFrameMs = 0;

function isLogging() {
  if (logging === undefined) {
    try {
      logging =
        globalThis.localStorage?.getItem(RENDER_STATS_STORAGE_KEY) === "1";
    } catch {
      logging = false;
    }
  }
  return logging;
}

// Records one composited frame that took `frameMs`, and logs the last
// second's counts and frame times when logging is on.
export function recordRenderFrame(frameMs: number, now = performance.now()) {
  if (!isLogging()) {
    return;
  }

  frames++;
  totalFrameMs += frameMs;
  maxFrameMs = Math.max(maxFrameMs, frameMs);
  if (!windowStart) {
    windowStart = now;
  }
  const elapsed = now - windowStart;
  if (elapsed < 1000) {
    return;
  }

  const perSecond = (key: keyof RenderStats) =>
    Math.round(((renderStats[key] - windowCounts[key]) * 1000) / elapsed);
  console.info(
    `[render] ${Math.round((frames * 1000) / elapsed)} fps, ` +
      `frame ${(totalFrameMs / frames).toFixed(2)} ms avg / ` +
      `${maxFrameMs.toFixed(2)} ms max, ` +
      `targets ${perSecond("targetAllocations")}/s, ` +
      `text ${perSecond("textRasterizations")}/s, ` +
      `fill ${perSecond("fillRasterizations")}/s`,
  );
  windowStart = now;
  windowCounts = { ...renderStats };
  frames = 0;
  totalFrameMs = 0;
  maxFrameMs = 0;
}
