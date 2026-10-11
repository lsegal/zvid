import { devices, expect, type Page, test } from "@playwright/test";

// Not component tests: these need real playback and usePhoneShell's Record wiring (the rest is in PreviewPanel.phone.component.test.tsx).
// The phone shell's transport VU meter and status toast (#1177).
const { defaultBrowserType: _, ...PHONE } = devices["Pixel 7"];

test.use({ ...PHONE, viewport: { width: 375, height: 667 } });

// A 440 Hz tone at about -13 dBFS RMS, as a 16-bit mono WAV.
function toneWav(seconds = 20, sampleRate = 22_050) {
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 2);
  }
  return wav.toString("base64");
}

// Drops the tone on a new source track, which the preview plays while there
// are no layer clips.
async function addTone(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Show Source Tracks" }).click();
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, toneWav());
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

function transportLevel(page: Page) {
  return page
    .locator(".mobile-transport")
    .getByRole("meter", { name: "Left level" });
}

test("the transport's VU meter moves with playback", async ({ page }) => {
  await page.goto("/");
  await addTone(page);
  const level = transportLevel(page);
  await expect(level).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => Number(await level.getAttribute("aria-valuenow")), {
      timeout: 15_000,
    })
    .toBeGreaterThan(-40);
});

test("Record with no armed track shows its hint as a toast", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const toast = page.getByRole("status").filter({
    hasText: "Arm a source track to record a take.",
  });
  await expect(toast).toBeVisible();
  // It opens the Media sheet's Record tab to pick inputs from.
  await expect(page.getByRole("button", { name: "Close media" })).toBeVisible();
});
