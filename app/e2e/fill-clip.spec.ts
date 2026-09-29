import { expect, type Page, test } from "@playwright/test";

// The selection menu's Insert Fill Clip turns the timeline selection into a
// fill clip, painted by a Color effect that switches between a colour and a
// gradient.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function dragSelection(
  page: Page,
  laneId: string,
  fromX: number,
  toX: number,
) {
  const bounds = await lane(page, laneId).boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + fromX, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + (fromX + toX) / 2, y);
  await page.mouse.move(bounds.x + toX, y);
  await page.mouse.up();
}

test("Insert Fill Clip adds a fill clip with a Solid/Gradient Color effect", async ({
  page,
}) => {
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();

  await dragSelection(page, "1", 40, 260);
  await expect(page.locator(".timeline-selection")).toHaveCount(1);

  // Right-clicking the selection keeps it and offers Insert Fill Clip.
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();

  const fill = lane(page, "1").locator(".clip-card--fill");
  await expect(fill).toHaveCount(1);
  await expect(fill).toContainText("Fill");
  await expect(fill).toHaveClass(/clip-card--selected/);
  await expect(page.locator(".timeline-selection")).toHaveCount(0);

  // The layer got a Color effect in Solid mode: one colour swatch.
  const device = page.locator('section[aria-label="Color"]');
  await expect(device).toBeVisible();
  await expect(device.getByRole("button", { name: "Solid" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    device.getByRole("button", { name: "Edit Color" }),
  ).toBeVisible();
  await expect(
    device.getByRole("button", { name: "Edit Gradient" }),
  ).toHaveCount(0);

  // Gradient mode swaps the colour swatch for a gradient swatch, and the
  // clip previews the gradient.
  await device.getByRole("button", { name: "Gradient" }).click();
  await expect(device.getByRole("button", { name: "Edit Color" })).toHaveCount(
    0,
  );
  const gradientSwatch = device.getByRole("button", { name: "Edit Gradient" });
  await expect(gradientSwatch).toBeVisible();
  await expect(fill.locator(".clip-card__fill")).toHaveAttribute(
    "style",
    /linear-gradient/,
  );

  // The swatch opens the picker in a popover.
  await gradientSwatch.click();
  await expect(page.locator(".popover-content")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".popover-content")).toHaveCount(0);

  // Undo removes the fill and its Color effect in one step.
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(lane(page, "1").locator(".clip-card--fill")).toHaveCount(0);
});
