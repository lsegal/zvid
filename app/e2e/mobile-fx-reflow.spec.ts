import { expect, type Locator, type Page, test } from "@playwright/test";

// On a phone, the FX sheet's device and Animation panels reflow their
// properties by width instead of growing sideways, so nothing is clipped
// at the panel's edges (#1218). Desktop panels keep their layout.
//
// A text clip comes from the desktop selection menu, so each test builds
// its session at desktop size, then turns the page into a phone: a touch
// pointer and a phone-sized viewport switch the shell live.

function lane(page: Page) {
  return page.locator('[data-timeline-lane-id="1"]');
}

async function insertTextClip(page: Page) {
  const bounds = await lane(page).boundingBox();
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
    .getByRole("menuitem", { name: "Insert Text Clip" })
    .click();
  await expect(page.locator('section[aria-label="Text"]')).toBeVisible();
}

async function addLayerEffect(page: Page, name: RegExp) {
  await page.locator('[data-layer-header-id="1"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name })
    .click();
}

// A text clip in Reactive mode, with a labeled-knob-row device (Move),
// color wheels and a curve (Levels) and many knobs (EQ) on its layer.
async function buildSession(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(lane(page)).toBeVisible();
  await insertTextClip(page);
  await page
    .locator('section[aria-label="Text animation"]')
    .getByRole("group", { name: "Mode" })
    .getByRole("button", { name: "Reactive" })
    .click();
  for (const name of [/^Move/, /^Levels/, /^EQ/]) {
    await addLayerEffect(page, name);
  }
}

async function becomePhone(page: Page, width: number) {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await page.setViewportSize({ width, height: 820 });
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell--phone/);
  // The sheet shows the selected clip's chain, under its layer's.
  await page.locator(".clip-card--text").first().click();
  const fx = page.locator(".fx-panel");
  if (!(await fx.isVisible())) {
    await page
      .getByRole("navigation", { name: "Editor" })
      .getByRole("button", { name: "FX" })
      .click();
  }
  await expect(fx).toBeVisible();
  await expect(
    fx.locator(".mobile-sheet-header__title", { hasText: "Clip Text" }),
  ).toBeVisible();
  return fx;
}

// Every visible element of each panel, outside its panel's edges.
async function clippedControls(fx: Locator) {
  return fx.evaluate((sheet) => {
    const clipped: string[] = [];
    for (const panel of sheet.querySelectorAll(
      ".fx-device-panel, .fx-animation-panel",
    )) {
      const edges = panel.getBoundingClientRect();
      if (!edges.width) {
        continue;
      }
      for (const element of panel.querySelectorAll("*")) {
        const box = element.getBoundingClientRect();
        if (
          box.width &&
          (box.left < edges.left - 1 || box.right > edges.right + 1)
        ) {
          clipped.push(
            `${panel.getAttribute("aria-label")}: ${element.className}`,
          );
        }
      }
    }
    return clipped;
  });
}

async function scrollsSideways(fx: Locator) {
  return fx
    .locator(".fx-panel__body")
    .evaluate((body) => body.scrollWidth > body.clientWidth);
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

for (const width of [360, 430]) {
  test(`a ${width}px phone fits every FX property in its panel`, async ({
    page,
  }) => {
    await buildSession(page);
    const fx = await becomePhone(page, width);

    // Devices: wheels, curves, knob rows and many knobs wrap in the panel.
    for (const name of ["Move", "Levels", "EQ", "Text"]) {
      await expect(fx.getByRole("region", { name, exact: true })).toBeVisible();
    }
    expect(await clippedControls(fx)).toEqual([]);
    expect(await scrollsSideways(fx)).toBe(false);

    // Each of the Move's Start and End rows keeps its label beside its
    // first knob.
    const row = fx.locator(".fx-device-panel__knob-row").first();
    const [label, knob] = await Promise.all([
      row.locator(".fx-device-panel__row-label").boundingBox(),
      row.locator(".knob").first().boundingBox(),
    ]);
    expect(label && knob && label.x + label.width <= knob.x).toBe(true);
    expect(
      label && knob && label.y < knob.y + knob.height && knob.y < label.y + 20,
    ).toBe(true);

    // Animation: Mode, Timing, Reactivity, Motion and Parameters all show
    // whole, with no two overlapping.
    await fx.getByRole("button", { name: "Animation", exact: true }).click();
    const animation = fx.getByRole("region", { name: "Text animation" });
    await expect(animation).toBeVisible();
    expect(await clippedControls(fx)).toEqual([]);
    expect(await scrollsSideways(fx)).toBe(false);
    const parts = [
      animation.getByRole("group", { name: "Mode" }),
      animation.getByRole("group", { name: "Timing" }),
      animation.locator(".fx-animation-panel__knob"),
      animation.locator(".fx-select", { hasText: "Motion" }),
      animation.locator(".fx-animation-panel__parameters"),
    ];
    const boxes = await Promise.all(parts.map((part) => part.boundingBox()));
    for (const [index, box] of boxes.entries()) {
      expect(box, `part ${index}`).not.toBeNull();
      for (const other of boxes.slice(index + 1)) {
        expect(box && other && overlaps(box, other)).toBe(false);
      }
    }
    // Segmented options stay finger-sized.
    for (const option of await animation
      .getByRole("group", { name: "Mode" })
      .getByRole("button")
      .all()) {
      expect((await option.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
        36,
      );
    }
  });
}

test("desktop FX panels keep their row-limited layout", async ({ page }) => {
  await buildSession(page);
  await page.locator(".clip-card--text").first().click();
  await expect(page.locator('section[aria-label="Text"]')).toBeVisible();
  const flow = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).gridAutoFlow);
  expect(await flow(".fx-animation-panel__body")).toBe("column");
  expect(await flow(".fx-device-panel__controls")).toBe("column");
  await expect(
    page
      .locator('section[aria-label="Text"]')
      .locator(".fx-device-panel__body--columns"),
  ).toHaveCSS("display", "flex");
  await expect(page.locator(".fx-device-panel__knob-row").first()).toHaveCSS(
    "display",
    "contents",
  );
});
