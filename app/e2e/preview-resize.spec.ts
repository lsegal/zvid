import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

// The selected layer's resize handles and origin marker in the preview:
// Shift keeps the aspect ratio, Ctrl/Cmd resizes from the centre, dragging
// the origin leaves the layer in place, and every drag is one undo step. The
// controls sit in the unclipped overlay, so they work past the video edge.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);
const FROM_CENTER_KEY = process.platform === "darwin" ? "Meta" : "Control";

// A new session's Order slides each layer in as its clip starts, so at the
// playhead a clip was just placed at the layer isn't there yet. These tests
// need it in place, so they turn that animation off.
async function holdOrderStill(page: Page) {
  await page
    .getByRole("button", { name: "Turn Animation Off for Order" })
    .click();
  await expect(
    page.getByRole("button", { name: "Turn Animation On for Order" }),
  ).toHaveAttribute("aria-pressed", "false");
}

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

// The letterboxed video inside the monitor, in page coordinates.
async function videoRect(page: Page) {
  return page.locator(".composition-player__canvas").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    const element = canvas as HTMLCanvasElement;
    const fit = Math.min(
      bounds.width / element.width,
      bounds.height / element.height,
    );
    const width = element.width * fit;
    const height = element.height * fit;
    return {
      left: bounds.left + (bounds.width - width) / 2,
      top: bounds.top + (bounds.height - height) / 2,
      width,
      height,
    };
  });
}

async function centreOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("element is not visible");
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// The outline's corners, in page coordinates, without its stroke.
async function outlineBox(page: Page) {
  return page.getByTestId("preview-transform-outline").evaluate((polygon) => {
    const bounds = (
      polygon as SVGPolygonElement
    ).ownerSVGElement?.getBoundingClientRect();
    const points = (polygon.getAttribute("points") ?? "")
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number));
    const xs = points.map(([x]) => x + (bounds?.left ?? 0));
    const ys = points.map(([, y]) => y + (bounds?.top ?? 0));
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
    };
  });
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function expectUndoLabel(page: Page, label: RegExp) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Undo/ })).toHaveText(label);
  await page.keyboard.press("Escape");
}

async function undo(page: Page) {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Undo/ }).click();
}

function expectClose(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

async function selectLayer(page: Page) {
  await page.goto("/");
  await holdOrderStill(page);
  await expect(page.locator('[data-timeline-lane-id="1"]')).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  await page.locator(".source-span").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy to layer" }).hover();
  await page.getByRole("menuitem", { name: "Layer 1" }).click();
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });

  const initial = await videoRect(page);
  await page.mouse.click(
    initial.left + initial.width / 2,
    initial.top + initial.height / 2,
  );
  await expect(page.getByTestId("preview-transform-outline")).toHaveCount(1);
  // Nudge the layer there and back so it has a Transform before measuring:
  // adding the Transform's card can resize the preview.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("region", { name: "Transform", exact: true }),
  ).toHaveCount(1);
  let previous = "";
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await videoRect(page));
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { intervals: [200] },
    )
    .toBe(true);
  return videoRect(page);
}

test("the selected layer shows eight handles and an origin marker", async ({
  page,
}) => {
  const video = await selectLayer(page);
  await expect(page.locator("[data-transform-handle]")).toHaveCount(8);
  const origin = await centreOf(page.getByTestId("preview-transform-origin"));
  expectClose(origin.x, video.left + video.width / 2);
  expectClose(origin.y, video.top + video.height / 2);
  await expect(page.getByTestId("preview-transform-handle-se")).toHaveCSS(
    "cursor",
    "nwse-resize",
  );
  await expect(page.getByTestId("preview-transform-handle-e")).toHaveCSS(
    "cursor",
    "ew-resize",
  );
});

test("a corner drag with Shift and Ctrl/Cmd scales proportionally about the centre", async ({
  page,
}) => {
  const video = await selectLayer(page);
  const before = await outlineBox(page);
  const corner = await centreOf(
    page.getByTestId("preview-transform-handle-se"),
  );

  await page.keyboard.down("Shift");
  await page.keyboard.down(FROM_CENTER_KEY);
  // Mostly sideways: Shift still shrinks both axes by the same factor.
  await drag(page, corner, {
    x: corner.x - video.width * 0.25,
    y: corner.y - video.height * 0.05,
  });
  await page.keyboard.up(FROM_CENTER_KEY);
  await page.keyboard.up("Shift");

  const after = await outlineBox(page);
  expect(after.width).toBeLessThan(before.width * 0.9);
  // Proportional: the aspect ratio holds.
  expectClose(after.width / after.height, before.width / before.height, 0.02);
  // From the centre: it shrank evenly on every side.
  expectClose(after.x + after.width / 2, before.x + before.width / 2);
  expectClose(after.y + after.height / 2, before.y + before.height / 2);

  await expectUndoLabel(page, /^Undo Resize test-pattern/);
  await undo(page);
  const restored = await outlineBox(page);
  expectClose(restored.width, before.width);
});

test("an edge drag resizes one side and keeps the opposite edge", async ({
  page,
}) => {
  const video = await selectLayer(page);
  const before = await outlineBox(page);
  const edge = await centreOf(page.getByTestId("preview-transform-handle-e"));

  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x - video.width * 0.2, edge.y + 30, {
    steps: 6,
  });
  let during = await outlineBox(page);
  expectClose(during.x, before.x);
  expectClose(during.height, before.height);
  expectClose(during.width, before.width * 0.8, 3);

  // Pressing Shift mid-drag switches to proportional at once.
  await page.keyboard.down("Shift");
  await expect
    .poll(async () => (await outlineBox(page)).height)
    .toBeLessThan(before.height * 0.9);
  during = await outlineBox(page);
  expectClose(during.width / during.height, before.width / before.height, 0.02);
  await page.keyboard.up("Shift");
  await expect
    .poll(async () => (await outlineBox(page)).height)
    .toBeGreaterThan(before.height - 2);
  await page.mouse.up();

  const after = await outlineBox(page);
  expectClose(after.x, before.x);
  expectClose(after.width, before.width * 0.8, 3);
  await expectUndoLabel(page, /^Undo Resize test-pattern/);
});

test("dragging the origin moves the pivot but not the layer", async ({
  page,
}) => {
  const video = await selectLayer(page);
  const before = await outlineBox(page);
  const marker = page.getByTestId("preview-transform-origin");
  const origin = await centreOf(marker);

  const target = {
    x: video.left + video.width * 0.8,
    y: video.top + video.height * 0.3,
  };
  await drag(page, origin, target);

  const moved = await centreOf(marker);
  expectClose(moved.x, target.x);
  expectClose(moved.y, target.y);
  const after = await outlineBox(page);
  expectClose(after.x, before.x);
  expectClose(after.y, before.y);
  expectClose(after.width, before.width);
  expectClose(after.height, before.height);
  await expectUndoLabel(page, /^Undo Move origin/);

  // It snaps to a corner nearby.
  const corner = await centreOf(
    page.getByTestId("preview-transform-handle-ne"),
  );
  await drag(page, moved, { x: corner.x - 4, y: corner.y + 3 });
  const snapped = await centreOf(marker);
  expectClose(snapped.x, corner.x, 1);
  expectClose(snapped.y, corner.y, 1);

  // Double-clicking it puts it back in the centre, still without moving
  // the layer.
  await page.mouse.dblclick(snapped.x, snapped.y);
  const reset = await centreOf(marker);
  expectClose(reset.x, video.left + video.width / 2);
  expectClose(reset.y, video.top + video.height / 2);
  const unchanged = await outlineBox(page);
  expectClose(unchanged.x, before.x);
  expectClose(unchanged.width, before.width);
});

test("handles outside the video area can still be dragged", async ({
  page,
}) => {
  const video = await selectLayer(page);
  const monitor = await page
    .getByTestId("preview-transform-overlay")
    .boundingBox();
  if (!monitor) {
    throw new Error("preview monitor is not visible");
  }

  // Move the layer halfway into the monitor's letterbox or pillarbox bar, so
  // one edge and its handle sit outside the video.
  const barX = monitor.x + monitor.width - (video.left + video.width);
  const barY = monitor.y + monitor.height - (video.top + video.height);
  const sideways = barX >= barY;
  expect(Math.max(barX, barY)).toBeGreaterThan(16);
  // Grab the layer away from the origin marker in its centre.
  const grab = {
    x: video.left + video.width * 0.3,
    y: video.top + video.height * 0.3,
  };
  await drag(page, grab, {
    x: grab.x + (sideways ? barX / 2 : 0),
    y: grab.y + (sideways ? 0 : barY / 2),
  });
  const moved = await outlineBox(page);
  const handle = await centreOf(
    page.getByTestId(`preview-transform-handle-${sideways ? "e" : "s"}`),
  );
  if (sideways) {
    expect(handle.x).toBeGreaterThan(video.left + video.width + 4);
  } else {
    expect(handle.y).toBeGreaterThan(video.top + video.height + 4);
  }

  const shrink = sideways ? video.width * 0.3 : video.height * 0.3;
  await drag(page, handle, {
    x: handle.x - (sideways ? shrink : 0),
    y: handle.y - (sideways ? 0 : shrink),
  });
  const after = await outlineBox(page);
  if (sideways) {
    expectClose(after.x, moved.x);
    expectClose(after.width, moved.width - shrink, 3);
  } else {
    expectClose(after.y, moved.y);
    expectClose(after.height, moved.height - shrink, 3);
  }
  await expectUndoLabel(page, /^Undo Resize test-pattern/);
});
