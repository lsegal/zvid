import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PIANO_ROLL_GRIDS,
  PIANO_ROLL_MIN_CELL_PX,
  pianoRollCellsPerQ,
  pianoRollGridLabel,
} from "./piano-roll-grid.ts";

describe("piano roll grid", () => {
  it("offers Adaptive first, then a quarter down to a thirty-second triplet", () => {
    assert.deepEqual(PIANO_ROLL_GRIDS, [
      "adaptive",
      "1/4",
      "1/4T",
      "1/8",
      "1/8T",
      "1/16",
      "1/16T",
      "1/32",
      "1/32T",
    ]);
  });

  it("gives a fixed grid's cells per quarter at any zoom", () => {
    for (const quarterPx of [8, 32, 256]) {
      assert.equal(pianoRollCellsPerQ("1/4", quarterPx), 1);
      assert.equal(pianoRollCellsPerQ("1/4T", quarterPx), 1.5);
      assert.equal(pianoRollCellsPerQ("1/16", quarterPx), 4);
      assert.equal(pianoRollCellsPerQ("1/32T", quarterPx), 12);
    }
  });

  it("resolves Adaptive to the finest straight value with cells at least 32px", () => {
    assert.equal(pianoRollCellsPerQ("adaptive", 32), 1);
    assert.equal(pianoRollCellsPerQ("adaptive", 63), 1);
    assert.equal(pianoRollCellsPerQ("adaptive", 64), 2);
    assert.equal(pianoRollCellsPerQ("adaptive", 128), 4);
    assert.equal(pianoRollCellsPerQ("adaptive", 256), 8);
    assert.equal(pianoRollCellsPerQ("adaptive", 1000), 8);
    // Zoomed out past a quarter's 32px, cells span half and whole notes.
    assert.equal(pianoRollCellsPerQ("adaptive", 16), 0.5);
    assert.equal(pianoRollCellsPerQ("adaptive", 8), 0.25);
  });

  it("never draws an Adaptive cell narrower than 32px across the roll's zooms", () => {
    // The roll's zoom runs from 25% to 800% of 32px quarters.
    for (let quarterPx = 8; quarterPx <= 256; quarterPx += 0.5) {
      const cellPx = quarterPx / pianoRollCellsPerQ("adaptive", quarterPx);
      assert.ok(cellPx >= PIANO_ROLL_MIN_CELL_PX, `${quarterPx}px quarters`);
      // And no coarser than it needs to be, short of the finest value.
      assert.ok(
        cellPx < PIANO_ROLL_MIN_CELL_PX * 2 ||
          pianoRollCellsPerQ("adaptive", quarterPx) === 8,
        `${quarterPx}px quarters`,
      );
    }
  });

  it("names the value Adaptive resolves to", () => {
    assert.equal(pianoRollGridLabel("adaptive", 32), "Adaptive (1/4)");
    assert.equal(pianoRollGridLabel("adaptive", 128), "Adaptive (1/16)");
    assert.equal(pianoRollGridLabel("adaptive", 8), "Adaptive (1/1)");
    assert.equal(pianoRollGridLabel("1/8T", 128), "1/8T");
  });
});
