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
