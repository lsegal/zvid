import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Every clip with sound gets a Gain audio effect at 0 dB in its own stack,
// shown with a vertical fader and a Mute toggle. Clips without sound get
// none, and a removed Gain stays removed.
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

test("a new audio clip has a Gain with a vertical fader at 0 dB", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceMedia(page, AUDIO, "tone.wav", "audio/wav");

  await page.locator(".source-span").click();
  const gain = page.locator(clipDevices);
  await expect(gain).toHaveCount(1);
  await expect(gain).toHaveAttribute("aria-label", "Gain");
  await expect(gain.getByRole("img", { name: "Audio effect" })).toBeVisible();
  // Audio effects have no Animation modifier.
  await expect(
    gain.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);

  const fader = gain.getByRole("slider", { name: "Gain" });
  await expect(fader).toHaveAttribute("aria-orientation", "vertical");
  await expect(fader).toHaveAttribute("aria-valuetext", "0.0 dB");

  // Dragging to the bottom mutes it.
  const box = await fader.boundingBox();
  if (!box) throw new Error("no fader box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 40, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(fader).toHaveAttribute("aria-valuetext", "Mute");
  await expect(gain.getByRole("button", { name: /^Gain: Mute/ })).toHaveText(
    "Mute",
  );

  // Double-click resets it to 0 dB; arrow keys step it.
  await fader.dblclick();
  await expect(fader).toHaveAttribute("aria-valuetext", "0.0 dB");
  await fader.press("ArrowDown");
  await expect(fader).toHaveAttribute("aria-valuetext", "−1.0 dB");

  // Typing into the readout sets it.
  await gain.getByRole("button", { name: /^Gain: / }).click();
  const input = gain.getByRole("textbox", { name: "Gain value" });
  await input.fill("-6");
  await input.press("Enter");
  await expect(fader).toHaveAttribute("aria-valuetext", "−6.0 dB");

  // The Mute toggle.
  const mute = gain.getByRole("button", { name: "Mute Gain" });
  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "false");

  // A layer clip made from the source clip gets its own Gain.
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await expect(
    page.locator(clipDevices).getByRole("slider", { name: "Gain" }),
  ).toHaveAttribute("aria-valuetext", "0.0 dB");

  // Removing Gain leaves the clip without one, and the add menu, which
  // offers an audio clip only audio effects, brings it back.
  await page
    .locator(clipDevices)
    .getByRole("button", { name: "Remove Gain" })
    .click();
  await expect(page.locator(clipDevices)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /^Transform/ })).toHaveCount(
    0,
  );
  await menu.getByRole("menuitem", { name: /^Gain/ }).click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
  await expect(
    page.locator(clipDevices).getByRole("slider", { name: "Gain" }),
  ).toHaveAttribute("aria-valuetext", "0.0 dB");
});

test("a video clip without sound gets no Gain", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceMedia(page, VIDEO, "test-pattern.mp4", "video/mp4");

  await page.locator(".source-span").click();
  await expect(page.locator(".fx-panel__toggle")).toHaveText(/^Clip /);
  await expect(page.locator(clipDevices)).toHaveCount(0);

  // Its add menu lists the audio effects in their own group.
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const audio = page.getByRole("menu").getByRole("group", { name: "Audio" });
  await expect(
    page.getByRole("menu").getByRole("group", { name: "Video" }),
  ).toBeVisible();
  await audio.getByRole("menuitem", { name: /^Gain/ }).click();
  await expect(page.locator(clipDevices)).toHaveCount(1);
});
