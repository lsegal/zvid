import { expect, type Page, test } from "@playwright/test";

// The loop region (#1099): its brace in the ruler is yellow, and its in and
// out markers run down the timeline as yellow dotted lines with a faint
// yellow tint between them, behind the clips.

const LOOP_YELLOW = "rgb(242, 209, 92)";

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function box(page: Page, selector: string) {
  const bounds = await page.locator(selector).first().boundingBox();
  if (!bounds) {
    throw new Error(`${selector} is not visible`);
  }
  return bounds;
}

// Inserts a fill clip on Layer 1 and leaves it unselected, so it stacks at
// the clips' own depth rather than the selected clip's.
async function insertFillClip(page: Page) {
  const bounds = await box(page, '[data-timeline-lane-id="1"]');
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 200, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 300, y);
  await page.mouse.move(bounds.x + 400, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 300, y, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();
  const fill = lane(page, "1").locator(".clip-card--fill");
  await expect(fill).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fill).not.toHaveClass(/clip-card--selected/);
  return fill;
}

// The topmost element at a point, counting the loop overlay even though it
// lets pointer events through.
async function topmostAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const overlays = [
        ...document.querySelectorAll<HTMLElement>(".loop-overlay"),
      ];
      for (const overlay of overlays) {
        overlay.style.pointerEvents = "auto";
        for (const line of overlay.children) {
          (line as HTMLElement).style.pointerEvents = "auto";
        }
      }
      const element = document.elementFromPoint(x, y);
      for (const overlay of overlays) {
        overlay.style.pointerEvents = "";
        for (const line of overlay.children) {
          (line as HTMLElement).style.pointerEvents = "";
        }
      }
      if (element?.closest(".clip-card")) {
        return "clip";
      }
      return element?.closest(".loop-overlay") ? "loop" : "other";
    },
    { x, y },
  );
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
});

test("the loop is yellow in the ruler and runs down the timeline behind clips", async ({
  page,
}) => {
  const fill = await insertFillClip(page);
  await expect(page.locator(".loop-overlay")).toHaveCount(0);

  // Lock a loop from before the clip to its middle.
  const clip = await fill.boundingBox();
  const strip = await box(page, ".ruler-loop-strip");
  if (!clip) {
    throw new Error("The clip is not visible");
  }
  const stripY = strip.y + strip.height / 2;
  await page.mouse.move(clip.x - 80, stripY);
  await page.mouse.down();
  await page.mouse.move(clip.x + clip.width / 2, stripY, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press("l");
  await expect(page.locator(".ruler-loop-region")).toBeVisible();

  // The ruler brace is the loop yellow.
  const background = (selector: string) =>
    page
      .locator(selector)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await background(".ruler-loop-region__marker--in")).toBe(LOOP_YELLOW);
  expect(await background(".ruler-loop-region__marker--out")).toBe(LOOP_YELLOW);
  const bodyColor = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background =
      "color-mix(in srgb, var(--loop-yellow) 85%, transparent)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(await background(".ruler-loop-region")).toBe(bodyColor);

  // Dotted yellow lines at the loop's ends, from the ruler's bottom through
  // the layer rows, with a faint tint between them.
  const region = await box(page, ".ruler-loop-region");
  const start = await box(page, ".timeline-loop .loop-overlay__line--start");
  const end = await box(page, ".timeline-loop .loop-overlay__line--end");
  const tint = await box(page, ".timeline-loop");
  expect(Math.abs(start.x - region.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(end.x + end.width - (region.x + region.width))).toBeLessThan(
    1,
  );
  expect(Math.abs(tint.x - start.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(tint.x + tint.width - (end.x + end.width))).toBeLessThan(1);
  const ruler = await box(page, ".ruler-row");
  const layer = await box(page, '[data-timeline-lane-id="1"]');
  expect(Math.abs(start.y - (ruler.y + ruler.height))).toBeLessThanOrEqual(1);
  expect(start.y + start.height).toBeGreaterThanOrEqual(layer.y + layer.height);
  for (const line of ["start", "end"]) {
    const style = await page
      .locator(`.timeline-loop .loop-overlay__line--${line}`)
      .evaluate((element) => {
        const computed = getComputedStyle(element);
        return [computed.borderLeftStyle, computed.borderLeftColor];
      });
    expect(style).toEqual(["dotted", LOOP_YELLOW]);
  }
  expect(await background(".timeline-loop")).not.toBe("rgba(0, 0, 0, 0)");

  // The Audio row carries the loop too, lined up with the rows.
  const audioStart = await box(
    page,
    ".audio-row__loop .loop-overlay__line--start",
  );
  expect(Math.abs(audioStart.x - start.x)).toBeLessThanOrEqual(1);

  // The clip paints over the end line and tint, which paint over the lane.
  const clipY = clip.y + clip.height / 2;
  expect(await topmostAt(page, end.x + 0.5, clipY)).toBe("clip");
  expect(await topmostAt(page, (clip.x + end.x) / 2, clipY)).toBe("clip");
  expect(await topmostAt(page, start.x + 0.5, clipY)).toBe("loop");
  expect(await topmostAt(page, (start.x + clip.x) / 2, clipY)).toBe("loop");
  // And none of it takes the pointer.
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest(".loop-overlay"),
    { x: start.x + 0.5, y: clipY },
  );
  expect(hit).toBeNull();

  // Deleting the loop removes its lines and tint.
  await page.locator(".ruler-loop-region__body").dblclick();
  await expect(page.locator(".ruler-loop-region")).toHaveCount(0);
  await expect(page.locator(".loop-overlay")).toHaveCount(0);
});
