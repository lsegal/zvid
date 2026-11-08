import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderApp } from "../../component-test/app.tsx";
import { down, move, nextFrames, up } from "../../component-test/input.ts";
import { setViewport } from "../../component-test/viewport.ts";

// Zooming the piano roll scales its grid inside the Notes region, which keeps
// the size it has rather than growing or shrinking with the grid (#1652).

const query = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`No ${selector}`);
  }
  return element;
};

// The MIDI sample's Arp clip, whose Clip and Notes regions lead the chain.
async function openMidiClip() {
  for (const name of ["File", "Open", "Samples", "MIDI"]) {
    await userEvent.click(page.getByRole("menuitem", { name, exact: true }));
  }
  const clip = () =>
    [...document.querySelectorAll<HTMLElement>("[data-source-span-id]")].find(
      (span) => span.textContent?.startsWith("Arp"),
    );
  await expect.poll(clip, { timeout: 30_000 }).toBeTruthy();
  await userEvent.click(clip() as HTMLElement);
  await expect.poll(() => document.querySelector(".piano-roll")).not.toBeNull();
  await nextFrames();
}

// The Notes region's and the FX panel's boxes.
function sizes() {
  const roll = query(".piano-roll").getBoundingClientRect();
  const panel = query(".fx-panel").getBoundingClientRect();
  return {
    roll: { width: roll.width, height: roll.height },
    panel: { width: panel.width, height: panel.height },
  };
}

// Right-drags the ruler up (in) or down (out) by `dy`, a step at a time,
// checking the sizes after every step.
async function zoomBy(dy: number, expected: ReturnType<typeof sizes>) {
  const ruler = query("[data-piano-roll-ruler]").getBoundingClientRect();
  const scroller = query(".piano-roll__scroll").getBoundingClientRect();
  const x = scroller.left + 120;
  const y = ruler.bottom - 3;
  await move(x, y);
  await down({ button: "right" });
  for (let step = 1; step <= 8; step++) {
    await move(x, y + (dy * step) / 8);
    await nextFrames();
    expect(sizes()).toEqual(expected);
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  await up({ button: "right" });
  await nextFrames();
}

test("zooming the roll keeps the Notes region's size and scales the notes", async () => {
  await setViewport({ width: 1389, height: 800 });
  await renderApp();
  await openMidiClip();
  const before = sizes();
  const scroller = query(".piano-roll__scroll");
  const grid = query("[data-piano-roll-grid]");
  const note = () => query(".piano-roll__note");
  const noteWidth = note().offsetWidth;

  // All the way in: fewer, wider notes in the same region.
  await zoomBy(-600, before);
  expect(note().offsetWidth).toBeGreaterThan(noteWidth * 4);

  // All the way out: narrower notes, and the grid still fills the roll.
  await zoomBy(1200, before);
  expect(note().offsetWidth).toBeLessThan(noteWidth / 2);
  expect(grid.offsetWidth).toBeGreaterThanOrEqual(
    scroller.clientWidth - query(".piano-roll__keys").offsetWidth,
  );
  expect(sizes()).toEqual(before);
});
