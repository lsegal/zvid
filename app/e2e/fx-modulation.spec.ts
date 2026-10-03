import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The Modulation modifier: the audio side's Animation. Audio devices get a
// motion-icon toggle beside their power button that attaches a collapsible
// Modulation section to the device's right edge, with Transient and LFO
// modes.
const AUDIO = new URL("./fixtures/tone.wav", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });

async function addSourceMedia(page: Page) {
  const base64 = (await readFile(AUDIO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const eventType of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, eventType, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

test("an audio device's Modulation section attaches, switches modes and folds", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceMedia(page);
  await page.locator(".source-span").click();

  const gain = page.locator('.fx-chain section[aria-label="Gain"]');
  await expect(gain).toHaveCount(1);
  const section = page.locator('section[aria-label="Gain modulation"]');
  // Off until turned on, so a new audio effect sounds as it always has.
  const turnOn = gain.getByRole("button", {
    name: "Turn Modulation On for Gain",
  });
  await expect(turnOn).toHaveAttribute("aria-pressed", "false");
  await expect(section).toHaveCount(0);

  await turnOn.click();
  await expect(
    gain.getByRole("button", { name: "Turn Modulation Off for Gain" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(section).toBeVisible();

  // It's attached to the device's right edge.
  const device = await gain.boundingBox();
  const attached = await section.boundingBox();
  expect(
    device && attached && Math.abs(attached.x - (device.x + device.width)) <= 2,
  ).toBe(true);

  // Transient, with Reactive's controls and Gain's defaults.
  const mode = section.getByRole("group", { name: "Mode" });
  await expect(mode.getByRole("button")).toHaveText(["Transient", "LFO"]);
  await expect(mode.getByRole("button", { name: "Transient" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(section.getByRole("group", { name: "Timing" })).toBeVisible();
  await expect(
    section.getByRole("slider", { name: "Reactivity" }),
  ).toHaveAttribute("aria-valuetext", "0.3");
  await expect(section.getByRole("combobox", { name: "Motion" })).toHaveText(
    "Bounce",
  );
  // Mute is a toggle, so only the level can be modulated.
  await expect(
    section.getByRole("button", { name: "Parameters: 1 of 1" }),
  ).toBeVisible();

  // LFO: Shape, a synced Rate, Depth, Phase and Parameters.
  await mode.getByRole("button", { name: "LFO" }).click();
  await expect(section.getByRole("combobox", { name: "Shape" })).toHaveText(
    "Sine",
  );
  const sync = section.getByRole("group", { name: "Sync" });
  await expect(sync.getByRole("button", { name: "On" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(section.getByRole("combobox", { name: "Rate" })).toHaveText(
    "1 Bar",
  );
  await expect(section.getByRole("slider", { name: "Depth" })).toHaveAttribute(
    "aria-valuetext",
    "0.3",
  );
  await expect(section.getByRole("slider", { name: "Phase" })).toHaveAttribute(
    "aria-valuetext",
    "0°",
  );
  // Free-running, Rate is a knob in Hz.
  await sync.getByRole("button", { name: "Off" }).click();
  await expect(section.getByRole("slider", { name: "Rate" })).toHaveAttribute(
    "aria-valuetext",
    "1.00 Hz",
  );

  // It folds into a strip of its own.
  await section
    .getByRole("button", { name: "Collapse Gain modulation" })
    .click();
  await expect(
    section.getByRole("button", { name: "Expand Gain modulation" }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Expand Gain modulation" }).click();

  // Turned off, the section goes and the settings stay for next time.
  await gain
    .getByRole("button", { name: "Turn Modulation Off for Gain" })
    .click();
  await expect(section).toHaveCount(0);
  await gain
    .getByRole("button", { name: "Turn Modulation On for Gain" })
    .click();
  await expect(
    section.getByRole("group", { name: "Mode" }).getByRole("button", {
      name: "LFO",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});
