import { expect, type Page, test } from "@playwright/test";

// The toolbar's status light follows the transport (#1097): yellow when
// stopped, green while playing, red while recording.
test.use({
  viewport: { width: 1600, height: 1000 },
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

const YELLOW = "rgb(246, 183, 60)";
const GREEN = "rgb(63, 198, 107)";
const RED = "rgb(239, 68, 68)";

function statusLight(page: Page) {
  return page.locator(".timeline-toolbar .status-light");
}

async function expectLight(page: Page, label: string, color: string) {
  const light = statusLight(page);
  await expect(light).toHaveAttribute("role", "img");
  await expect(light).toHaveAccessibleName(label);
  await expect(light).toHaveAttribute("title", label);
  await expect
    .poll(() =>
      light.evaluate((node) => getComputedStyle(node).backgroundImage),
    )
    .toContain(color);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-layer-header-id]").first()).toBeVisible();
});

test("the light is yellow when stopped and green while playing", async ({
  page,
}) => {
  await expectLight(page, "Stopped", YELLOW);
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expectLight(page, "Playing", GREEN);
  await page.getByRole("button", { name: "Pause playback" }).click();
  await expectLight(page, "Stopped", YELLOW);
});

test("the light is red while recording and yellow once stopped", async ({
  page,
}) => {
  // Saving the take analyzes and caches it, which is slow under load.
  test.setTimeout(90_000);
  await page
    .locator(".track-row--source-drop")
    .getByRole("button", { name: "Track", exact: true })
    .click();
  const track = page.locator(".track-row--source[data-source-track-id]");
  await track
    .first()
    .getByRole("button", { name: /^Arm .* for recording$/ })
    .click();
  const record = page.locator(".transport-button--record");

  await record.click();
  await expect(record).toHaveClass(/transport-button--recording/);
  await expectLight(page, "Recording", RED);

  // Stopping the recording keeps playback going.
  await record.click();
  await expect(record).not.toHaveClass(/transport-button--recording/);
  await expectLight(page, "Playing", GREEN);
  await expect(track.first().locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Pause playback" }).click();
  await expectLight(page, "Stopped", YELLOW);
});
