import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// Cut, Copy and Delete with a timeline selection act on exactly the selected
// span on its layer, and Paste reproduces what was cut.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

async function dropVideoIntoNewSourceTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Drags out a selection on `target` between two x offsets from the song
// start and returns its box.
async function dragSelection(target: Locator, fromX: number, toX: number) {
  const page = target.page();
  // Centred vertically, so the timeline's sticky header row doesn't cover
  // the lane when the FX panel leaves the timeline short.
  await target.evaluate(
    (element) =>
      new Promise((resolve) => {
        const scroller = element.closest(".timeline-scroll");
        const scrollLeft = scroller?.scrollLeft ?? 0;
        element.scrollIntoView({ block: "center" });
        if (scroller) {
          scroller.scrollLeft = scrollLeft;
        }
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  const bounds = await target.boundingBox();
  if (!bounds) {
    throw new Error("Target is not visible");
  }
  const y = bounds.y + 20;
  await page.mouse.move(bounds.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + toX, y, { steps: 4 });
  await page.mouse.up();
  const selection = target.locator(".timeline-selection");
  await expect(selection).toBeVisible();
  const box = await selection.boundingBox();
  if (!box) {
    throw new Error("Selection is not visible");
  }
  return box;
}

// The [left, right] edges of each clip on `target`, in page pixels.
async function clipEdges(target: Locator) {
  return target.locator(".clip-card").evaluateAll((cards) =>
    cards
      .map((card) => card.getBoundingClientRect())
      .map((rect) => [rect.left, rect.right])
      .toSorted((a, b) => a[0] - b[0]),
  );
}

// Waits for the clips on `target` to have `expected` edges, within a pixel.
async function expectEdges(target: Locator, expected: number[][]) {
  await expect
    .poll(async () => {
      const actual = await clipEdges(target);
      return (
        actual.length === expected.length &&
        actual.every(
          ([left, right], index) =>
            Math.abs(left - expected[index][0]) < 1 &&
            Math.abs(right - expected[index][1]) < 1,
        )
      );
    })
    .toBe(true);
}

// Default layers: "1" is Layer 1, "5" is Layer 2 and "6" is Layer 3.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollLeft = 0;
  });
  await dropVideoIntoNewSourceTrack(page);

  // A clip on Layer 1 and one on Layer 3, over the same span. Selections
  // start on empty lane space, then may extend over clips.
  for (const id of ["1", "6"]) {
    await dragSelection(lane(page, id), 130, 330);
    await page.keyboard.press("1");
    await expect(lane(page, id).locator(".clip-card")).toHaveCount(1);
  }
});

test("Delete removes only the selected span on its layer", async ({ page }) => {
  const [clip] = await clipEdges(lane(page, "1"));
  const otherLayer = await clipEdges(lane(page, "6"));
  // Over the clip's start, so Delete trims it to the part after the span.
  const selection = await dragSelection(lane(page, "1"), 30, 230);

  await page.keyboard.press("Delete");
  await expectEdges(lane(page, "1"), [
    [selection.x + selection.width, clip[1]],
  ]);
  await expectEdges(lane(page, "6"), otherLayer);
  // The selection stays, showing what was removed.
  await expect(lane(page, "1").locator(".timeline-selection")).toBeVisible();

  // One undo step restores the clip.
  await page.keyboard.press("ControlOrMeta+z");
  await expectEdges(lane(page, "1"), [clip]);
});

test("Cut then Paste reproduces the cut span on another layer", async ({
  page,
}) => {
  const [clip] = await clipEdges(lane(page, "1"));
  const otherLayer = await clipEdges(lane(page, "6"));
  // Dragged back over the clip's end, so the cut takes its end and some
  // empty space.
  const selection = await dragSelection(lane(page, "1"), 530, 230);

  await page.keyboard.press("ControlOrMeta+x");
  await expectEdges(lane(page, "1"), [[clip[0], selection.x]]);
  await expectEdges(lane(page, "6"), otherLayer);

  // Paste at the playhead on the selected layer: the cut piece, at the same
  // length.
  await page.keyboard.press("Escape");
  await page
    .locator(".track-label--lane")
    .filter({ hasText: "Layer 2" })
    .locator(".track-label__index")
    .click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(lane(page, "5").locator(".clip-card")).toHaveCount(1);
  const [pasted] = await clipEdges(lane(page, "5"));
  expect(pasted[1] - pasted[0]).toBeCloseTo(clip[1] - selection.x, 0);
  await expectEdges(lane(page, "1"), [[clip[0], selection.x]]);
  await expectEdges(lane(page, "6"), otherLayer);
});

test("Copy and Delete leave an empty selection alone", async ({ page }) => {
  const clips = await clipEdges(lane(page, "1"));
  await dragSelection(lane(page, "1"), 430, 530);

  await page.keyboard.press("ControlOrMeta+c");
  await expect(
    page.getByText("Nothing in the selection to copy."),
  ).toBeVisible();
  await page.keyboard.press("Delete");
  await expectEdges(lane(page, "1"), clips);
});

test("the selection menu's Cut, Copy and Delete act on the span", async ({
  page,
}) => {
  const [clip] = await clipEdges(lane(page, "1"));
  const selection = await dragSelection(lane(page, "1"), 30, 230);
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  await page.mouse.click(bounds.x + 80, bounds.y + 20, { button: "right" });
  const menu = page.getByRole("menu", { name: "Selection actions" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    /^Cut/,
    /^Copy/,
    /^Delete/,
    "Insert Track",
    "Insert Fill Clip",
    "Insert Text Clip",
    "Insert FX Clip",
    "Clear selectionEsc",
  ]);
  await menu.getByRole("menuitem", { name: /^Delete/ }).click();
  await expectEdges(lane(page, "1"), [
    [selection.x + selection.width, clip[1]],
  ]);
});
