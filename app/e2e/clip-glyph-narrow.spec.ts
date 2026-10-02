import { expect, type Locator, type Page, test } from "@playwright/test";

// Narrow Text and FX clips keep their "T" / "FX" glyph at full width and let
// the label give way, so they look like a wide clip cut off on the right.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

async function insertClip(page: Page, item: string) {
  const bounds = await lane(page, "1").boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, bounds.y + 20, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: item })
    .click();
}

// Squeezes the clip to `width` pixels, as a short clip or a far zoom-out
// would, and returns the glyph and label boxes relative to the clip.
async function layoutAt(clip: Locator, width: number) {
  return clip.evaluate((element, width) => {
    (element as HTMLElement).style.width = `${width}px`;
    const clipBox = element.getBoundingClientRect();
    const glyph = element.querySelector(".clip-card__glyph");
    const label = element.querySelector(".clip-card__text strong");
    if (!glyph || !label) {
      throw new Error("Clip has no glyph or label");
    }
    const glyphBox = glyph.getBoundingClientRect();
    return {
      glyphLeft: glyphBox.left - clipBox.left,
      glyphWidth: glyphBox.width,
      labelWidth: label.getBoundingClientRect().width,
    };
  }, width);
}

for (const { kind, item, glyph } of [
  { kind: "text", item: "Insert Text Clip", glyph: "T" },
  { kind: "fx", item: "Insert FX Clip", glyph: "FX" },
]) {
  test(`a narrow ${kind} clip keeps its ${glyph} glyph at full width`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(lane(page, "1")).toBeVisible();
    await insertClip(page, item);

    const clip = lane(page, "1").locator(`.clip-card--${kind}`);
    await expect(clip).toHaveCount(1);
    await expect(clip.locator(".clip-card__glyph")).toHaveText(glyph);

    const wide = await layoutAt(clip, 220);
    expect(wide.glyphWidth).toBe(28);
    expect(wide.labelWidth).toBeGreaterThan(0);

    // Too narrow for the label: the glyph keeps its width at the clip's
    // start and the label is squeezed out.
    const narrow = await layoutAt(clip, 50);
    expect(narrow.glyphWidth).toBe(28);
    expect(narrow.glyphLeft).toBeLessThanOrEqual(1);
    expect(narrow.labelWidth).toBe(0);

    // Narrower than the glyph: the clip cuts it off rather than shrinking it.
    const tiny = await layoutAt(clip, 20);
    expect(tiny.glyphWidth).toBe(28);

    // The start trim handle still sits over the clip's leading edge.
    await layoutAt(clip, 50);
    const handle = clip.locator(".clip-card__handle--start");
    const handleBox = await handle.boundingBox();
    const clipBox = await clip.boundingBox();
    if (!handleBox || !clipBox) {
      throw new Error("Clip or handle is not visible");
    }
    expect(handleBox.width).toBeGreaterThan(0);
    expect(handleBox.x).toBeCloseTo(clipBox.x, 0);
  });
}
