import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Mono is added from a clip's add menu, after the clip's Gain; a video
// clip's menu lists it in the Audio group. It shows Source as segmented
// buttons and Amount as a knob, and has no Animation modifier.
const AUDIO = new URL("./fixtures/tone.wav", import.meta.url);
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });

async function addSourceMedia(
  page: Page,
  file: URL,
  name: string,
  type: string,
) {
  const base64 = (await readFile(file)).toString("base64");
  const dataTransfer = await page.evaluateHandle(
    ({ data, name, type }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
      return transfer;
    },
    { data: base64, name, type },
  );
  const target = '[data-source-track-drop-target="new-track"]';
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, eventType, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';

test("Mono adds to an audio clip with Sum at 100 %", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceMedia(page, AUDIO, "tone.wav", "audio/wav");

  await page.locator(".source-span").click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  await page.getByRole("menu").getByRole("menuitem", { name: /^Mono/ }).click();

  const devices = page.locator(clipDevices);
  await expect(devices).toHaveCount(2);
  await expect(devices.nth(0)).toHaveAttribute("aria-label", "Gain");
  const mono = devices.nth(1);
  await expect(mono).toHaveAttribute("aria-label", "Mono");
  await expect(mono.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    mono.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);

  const source = mono.getByRole("group", { name: "Source" });
  await expect(source.getByRole("button")).toHaveText(["Sum", "Left", "Right"]);
  await expect(source.getByRole("button", { name: "Sum" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const amount = mono.getByRole("slider", { name: "Amount" });
  await expect(amount).toHaveAttribute("aria-valuetext", "100%");

  // Picking a side and turning Amount down.
  await source.getByRole("button", { name: "Left" }).click();
  await expect(source.getByRole("button", { name: "Left" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await amount.press("ArrowDown");
  await expect(amount).toHaveAttribute("aria-valuetext", "99%");

  // Removing it leaves the Gain.
  await mono.getByRole("button", { name: "Remove Mono" }).click();
  await expect(devices).toHaveCount(1);
  await expect(devices.nth(0)).toHaveAttribute("aria-label", "Gain");
});

test("a video clip's add menu lists Mono in its Audio group", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceMedia(page, VIDEO, "test-pattern.mp4", "video/mp4");

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("group", { name: "Video" }).getByRole("menuitem", {
      name: /^Mono/,
    }),
  ).toHaveCount(0);
  await menu
    .getByRole("group", { name: "Audio" })
    .getByRole("menuitem", { name: /^Mono/ })
    .click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await expect(page.locator(clipDevices)).toHaveAttribute("aria-label", "Mono");
});
