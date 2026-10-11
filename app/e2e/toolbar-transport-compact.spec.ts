import { expect, type Locator, type Page, test } from "@playwright/test";

// The toolbar row under the top bar and the transport bar are compact like
// the menu bar (#1222): each about 20% shorter than before (73px), with
// controls about 20% smaller, all still centered and comfortably clickable.

test.use({ viewport: { width: 1440, height: 900 } });

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("element has no box");
  return result;
}

async function expectCenteredIn(
  page: Page,
  bar: string,
  controls: Locator,
  { buttons = true } = {},
) {
  const barBox = await box(page.locator(bar));
  const barCenter = barBox.y + barBox.height / 2;
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const { y, height } = await box(controls.nth(index));
    expect(y).toBeGreaterThanOrEqual(barBox.y);
    expect(y + height).toBeLessThanOrEqual(barBox.y + barBox.height);
    expect(Math.abs(y + height / 2 - barCenter)).toBeLessThanOrEqual(1);
    expect(height).toBeLessThanOrEqual(36);
    // Smaller, but still an easy click.
    if (buttons) expect(height).toBeGreaterThanOrEqual(20);
  }
}

test("the toolbar row is compact and its controls fit it", async ({ page }) => {
  await page.goto("/");
  const bar = await box(page.locator(".timeline-toolbar"));
  expect(bar.height).toBeLessThanOrEqual(60);
  await expectCenteredIn(
    page,
    ".timeline-toolbar",
    page.locator(
      ".timeline-toolbar :is(.segmented-control, .tempo-pill, .signature-picker)",
    ),
  );
  for (const name of ["Sessions", "Tempo", "Snap On"]) {
    const button = page
      .locator(".timeline-toolbar")
      .getByRole("button", { name, exact: true });
    expect((await box(button)).height).toBeGreaterThanOrEqual(24);
  }
});

test("the transport bar is compact and its controls fit it", async ({
  page,
}) => {
  await page.goto("/");
  const bar = await box(page.locator(".transport-bar"));
  expect(bar.height).toBeLessThanOrEqual(60);
  await expectCenteredIn(
    page,
    ".transport-bar",
    page.locator(
      ".transport-bar :is(.transport-button, .zoom-control__button, .zoom-control__readout)",
    ),
  );
  await expectCenteredIn(
    page,
    ".transport-bar",
    page.locator(".transport-bar :is(.zoom-control__slider, .vu-meter)"),
    { buttons: false },
  );
  // The transport buttons stay the bar's largest controls.
  const play = await box(page.getByRole("button", { name: "Play timeline" }));
  expect(play.height).toBeGreaterThanOrEqual(32);
  expect(play.width).toBeGreaterThanOrEqual(play.height);
});

test("the sliders still drag accurately", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Preview volume" });
  const track = await box(slider);
  await page.mouse.move(track.x + 2, track.y + track.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  const value = Number(await slider.inputValue());
  expect(value).toBeGreaterThan(0.4);
  expect(value).toBeLessThan(0.6);
});

// Sharp icons (#1224): the bars shrink by padding, never by scaling icons,
// and everything lands on whole pixels, so nothing renders blurred.

async function rects(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const control = element.closest("button, [aria-label]");
      return {
        name: control?.getAttribute("aria-label") ?? element.className,
        className: control?.className ?? "",
        x,
        y,
        width,
        height,
      };
    }),
  );
}

function expectWhole(
  rect: Record<string, string | number>,
  keys: string[] = ["x", "y", "width", "height"],
) {
  for (const key of keys) {
    const value = Number(rect[key]);
    expect(
      Math.abs(value - Math.round(value)),
      `${rect.name} ${key} = ${value}`,
    ).toBeLessThan(0.01);
  }
}

function defaultIconSize(className: string) {
  if (className.includes("transport-button--record")) return 18;
  if (className.includes("transport-button")) return 20;
  if (className.includes("zoom-control__button")) return 16;
  if (className.includes("select-trigger")) return 14;
  return undefined;
}

test("icons keep their default sizes on whole pixels", async ({ page }) => {
  await page.goto("/");
  const icons = await rects(page, ".timeline-toolbar svg, .transport-bar svg");
  // Seven transport buttons, zoom − / +, mute and the time signature chevron.
  expect(icons.length).toBeGreaterThanOrEqual(11);
  for (const icon of icons) {
    const size = defaultIconSize(String(icon.className));
    expect(size, `${icon.name} has a known default size`).toBeDefined();
    expect([icon.name, icon.width, icon.height]).toEqual([
      icon.name,
      size,
      size,
    ]);
    expectWhole(icon);
  }
});

test("the bars and their buttons sit on whole pixels", async ({ page }) => {
  await page.goto("/");
  for (const bar of await rects(page, ".timeline-toolbar, .transport-bar")) {
    expectWhole(bar, ["y", "height"]);
  }
  // Text buttons are as wide as their labels; their heights and rows are
  // still whole.
  const buttons = await rects(
    page,
    ".timeline-toolbar button, .transport-bar :is(.transport-button, .zoom-control__button, .zoom-control__readout)",
  );
  for (const button of buttons) expectWhole(button, ["y", "height"]);
  // Icon buttons are whole all round, so their icons center on whole pixels.
  const iconButtons = await rects(
    page,
    ".transport-bar :is(.transport-button, .zoom-control__button)",
  );
  for (const button of iconButtons) expectWhole(button);
});
