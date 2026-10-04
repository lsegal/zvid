// Draws a growing recording clip's waveform and filmstrip, only for the part
// of the clip on screen, and only what changed since the last draw: columns
// and tiles whose peaks and frames are all in are left alone as the clip
// grows.
import { type LiveFrame, liveFrameAt } from "../../recording/live-take-monitor.ts";

// The parts of a 2D context the drawing uses, so tests can stand one in.
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "fillRect" | "drawImage"
> & { fillStyle: CanvasRenderingContext2D["fillStyle"] };

export type LiveClipView = {
  // The drawn slice, in pixels from the clip's left edge.
  startPx: number;
  widthPx: number;
  // How far the clip has grown, in pixels from its left edge.
  clipWidthPx: number;
  pxPerSecond: number;
};

export type LiveWaveform = {
  peaks: readonly number[];
  peakIntervalSeconds: number;
  heightPx: number;
};

export type LiveFilmstrip = {
  frames: readonly LiveFrame[];
  tileWidthPx: number;
  heightPx: number;
};

/** The tiles, by index from the clip's start, that overlap the slice. */
export function visibleTileRange(
  startPx: number,
  endPx: number,
  tileWidthPx: number,
) {
  if (!(tileWidthPx > 0) || endPx <= startPx) return { first: 0, end: 0 };
  return {
    first: Math.max(0, Math.floor(startPx / tileWidthPx)),
    end: Math.max(0, Math.ceil(endPx / tileWidthPx)),
  };
}

/**
 * The loudest peak under clip pixel `px`, and whether every peak it covers
 * has been taken, so it will not change again.
 */
export function waveformColumn(
  peaks: readonly number[],
  peakIntervalSeconds: number,
  pxPerSecond: number,
  px: number,
) {
  const fromSeconds = px / pxPerSecond;
  const toSeconds = (px + 1) / pxPerSecond;
  const from = Math.floor(fromSeconds / peakIntervalSeconds);
  const to = Math.max(from + 1, Math.ceil(toSeconds / peakIntervalSeconds));
  let peak = 0;
  for (let index = from; index < Math.min(to, peaks.length); index += 1) {
    peak = Math.max(peak, peaks[index] ?? 0);
  }
  return { peak, complete: to <= peaks.length };
}

/**
 * The frame tile `index` shows, and whether a later frame has been grabbed,
 * so it will not change again.
 */
export function tileFrame(
  frames: readonly LiveFrame[],
  index: number,
  tileWidthPx: number,
  pxPerSecond: number,
) {
  const atSeconds = (index * tileWidthPx) / pxPerSecond;
  const last = frames.at(-1);
  return {
    frame: liveFrameAt(frames, atSeconds),
    complete: !!last && last.atSeconds > atSeconds,
  };
}

type LayerState = { key: string; drawnPx: number };

export class LiveClipPainter {
  // What each canvas already shows, so a new canvas is drawn whole.
  private readonly layers = new WeakMap<DrawContext, LayerState>();

  private layer(context: DrawContext, key: string, width: number, height: number) {
    let state = this.layers.get(context);
    if (!state) {
      state = { key: "", drawnPx: 0 };
      this.layers.set(context, state);
    }
    if (state.key !== key) {
      state.key = key;
      state.drawnPx = 0;
      context.clearRect(0, 0, width, height);
    }
    return state;
  }

  /**
   * Draws the waveform columns from the first one that could still change
   * to the clip's end. The canvas is `view.widthPx` wide and starts at
   * `view.startPx`; a new slice, zoom or size redraws it whole.
   */
  paintWaveform(context: DrawContext, view: LiveClipView, wave: LiveWaveform) {
    const width = Math.ceil(view.widthPx);
    const key = `${view.startPx}:${width}:${view.pxPerSecond}:${wave.heightPx}`;
    const state = this.layer(context, key, width, wave.heightPx);
    if (!(view.pxPerSecond > 0)) return;
    const endPx = Math.min(width, Math.ceil(view.clipWidthPx - view.startPx));
    context.fillStyle = "rgba(255, 214, 214, 0.85)";
    let settled = true;
    for (let x = state.drawnPx; x < endPx; x += 1) {
      const { peak, complete } = waveformColumn(
        wave.peaks,
        wave.peakIntervalSeconds,
        view.pxPerSecond,
        view.startPx + x,
      );
      context.clearRect(x, 0, 1, wave.heightPx);
      const barHeight = Math.max(1, peak * wave.heightPx);
      context.fillRect(x, (wave.heightPx - barHeight) / 2, 1, barHeight);
      if (settled && complete) {
        state.drawnPx = x + 1;
      } else {
        settled = false;
      }
    }
  }

  /**
   * Draws the filmstrip tiles from the first one whose frame could still
   * change to the clip's end, on a canvas laid out like the waveform's.
   */
  paintFilmstrip(
    context: DrawContext,
    view: LiveClipView,
    strip: LiveFilmstrip,
  ) {
    const width = Math.ceil(view.widthPx);
    const key = `${view.startPx}:${width}:${view.pxPerSecond}:${strip.tileWidthPx}:${strip.heightPx}`;
    const state = this.layer(context, key, width, strip.heightPx);
    if (!(view.pxPerSecond > 0) || !strip.frames.length) return;
    const endPx = Math.min(view.startPx + width, view.clipWidthPx);
    const { first, end } = visibleTileRange(
      view.startPx + state.drawnPx,
      endPx,
      strip.tileWidthPx,
    );
    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    let settled = true;
    for (let index = first; index < end; index += 1) {
      const { frame, complete } = tileFrame(
        strip.frames,
        index,
        strip.tileWidthPx,
        view.pxPerSecond,
      );
      const x = index * strip.tileWidthPx - view.startPx;
      if (frame) {
        try {
          context.drawImage(
            frame.image,
            x,
            0,
            strip.tileWidthPx,
            strip.heightPx,
          );
        } catch {
          // A frame released mid-draw leaves its tile blank.
        }
      }
      // A dark line between tiles.
      context.fillRect(x + strip.tileWidthPx - 1, 0, 1, strip.heightPx);
      if (settled && complete) {
        state.drawnPx = Math.max(0, x + strip.tileWidthPx);
      } else {
        settled = false;
      }
    }
  }
}
