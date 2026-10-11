import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WAVEFORM_MAX_LEVEL, WAVEFORM_TICKS } from "../fx/controls/waveform.ts";
import {
  graticuleLevels,
  HISTOGRAM_LABEL_INSET_PX,
  HISTOGRAM_LABEL_MIN_PX,
  histogramShares,
  LEVEL_LABEL_MIN_PX,
} from "./scope-graticule.ts";
import { MIN_SCOPES_HEIGHT_PX } from "./scopes-height.ts";

// The least gap between neighbors of `levels` on a `heightPx`-tall plot.
function leastLevelGapPx(levels: number[], heightPx: number) {
  let least = Number.POSITIVE_INFINITY;
  for (let index = 1; index < levels.length; index++) {
    least = Math.min(least, levels[index] - levels[index - 1]);
  }
  return (least * heightPx) / WAVEFORM_MAX_LEVEL;
}

describe("graticuleLevels", () => {
  it("keeps every level when the plot has room", () => {
    assert.deepEqual(graticuleLevels(300), WAVEFORM_TICKS);
  });

  it("drops intermediate levels in steps as the plot shrinks", () => {
    assert.deepEqual(graticuleLevels(80), [0, 256, 512, 768, 1023]);
    assert.deepEqual(graticuleLevels(40), [0, 512, 1023]);
    assert.deepEqual(graticuleLevels(20), [0, 1023]);
    assert.deepEqual(graticuleLevels(0), [0, 1023]);
  });

  it("never lets labels overlap and always labels 0 and 1023", () => {
    let previous = 0;
    for (let height = 1; height <= 600; height += 0.5) {
      const levels = graticuleLevels(height);
      assert.equal(levels[0], 0);
      assert.equal(levels.at(-1), WAVEFORM_MAX_LEVEL);
      if (levels.length > 2) {
        assert.ok(leastLevelGapPx(levels, height) >= LEVEL_LABEL_MIN_PX);
      }
      // Growing the plot only ever adds levels back.
      assert.ok(levels.length >= previous);
      previous = levels.length;
    }
  });

  it("keeps the midline at the pane's least height", () => {
    // The plot is the pane less 8px of padding above and below.
    assert.ok(graticuleLevels(MIN_SCOPES_HEIGHT_PX - 16).includes(512));
  });
});

describe("histogramShares", () => {
  it("keeps quarters when the plot is wide", () => {
    assert.deepEqual(histogramShares(300), [0, 0.25, 0.5, 0.75, 1]);
  });

  it("thins to halves, then both ends, as the plot narrows", () => {
    assert.deepEqual(histogramShares(100), [0, 0.5, 1]);
    assert.deepEqual(histogramShares(50), [0, 1]);
  });

  it("never lets labels overlap", () => {
    for (let width = 64; width <= 600; width++) {
      const xs = histogramShares(width).map((share) =>
        Math.min(
          Math.max(width * share, HISTOGRAM_LABEL_INSET_PX),
          width - HISTOGRAM_LABEL_INSET_PX,
        ),
      );
      for (let index = 1; index < xs.length; index++) {
        assert.ok(xs[index] - xs[index - 1] >= HISTOGRAM_LABEL_MIN_PX);
      }
    }
  });
});
