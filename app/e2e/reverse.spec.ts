// Kept in Playwright: it checks the real export's downloaded MP4.
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// An export with the Reverse audio effect plays the clip's audio
// backwards: a loud first half and quiet second half come out the other
// way round. The rest of Reverse is covered by
// src/fx/effects/reverse/reverse.component.test.tsx.

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 120_000 });

// A 16-bit mono WAV whose first half plays `first` and second half
// `second`: a frequency in Hz and a peak out of 32767 each.
function twoPartWav(
  seconds: number,
  first: { hz: number; peak: number },
  second: { hz: number; peak: number },
) {
  const sampleRate = 8000;
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
    const { hz, peak } = index < frames / 2 ? first : second;
    const sample = Math.sin((2 * Math.PI * hz * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * peak), 44 + index * 2);
  }
  return wav.toString("base64");
}

async function addWav(page: Page, base64: string) {
  const dataTransfer = await page.evaluateHandle((wav) => {
    const bytes = Uint8Array.from(atob(wav), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

const clipDevices = '.fx-chain .fx-device-panel[data-fx-group="clip"]';

// Adds Reverse to the selected clip from its add menu, which for a clip
// with only sound lists the audio effects alone.
async function addReverse(page: Page) {
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("group", { name: "Video" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Utility" }).press("ArrowRight");
  await page.getByRole("menuitem", { name: /^Reverse/ }).click();
  const reverse = page.locator(`${clipDevices}[aria-label="Reverse"]`);
  await expect(reverse).toHaveCount(1);
  return reverse;
}

test("an export with Reverse plays the clip's audio backwards", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto("/");
  test.skip(
    !(await page.evaluate(
      async () =>
        (
          await AudioEncoder.isConfigSupported({
            codec: "mp4a.40.2",
            sampleRate: 48_000,
            numberOfChannels: 2,
            bitrate: 192_000,
          })
        ).supported,
    )),
    "This browser has no AAC encoder.",
  );
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // Loud first, quiet second.
  await addWav(
    page,
    twoPartWav(4, { hz: 440, peak: 10_000 }, { hz: 440, peak: 2_000 }),
  );
  await page.locator(".source-span").click();
  await addReverse(page);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Width").fill("320");
  await dialog.getByLabel("Height").fill("180");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const mp4 = await readFile(await (await download).path());

  // The offline render reads the clip's window backwards, as the unit
  // tests' offline render does: the quiet half first, then the loud one.
  const [first, second] = await page.evaluate(
    async (bytes) => {
      const context = new OfflineAudioContext(2, 1, 48_000);
      const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
      const samples = audio.getChannelData(0);
      const peak = (from: number, to: number) => {
        let max = 0;
        for (
          let index = Math.round(audio.length * from);
          index < Math.round(audio.length * to);
          index++
        ) {
          max = Math.max(max, Math.abs(samples[index]));
        }
        return max;
      };
      // Skips the encoder's priming, the fades at the ends and the switch
      // in the middle.
      return [peak(0.1, 0.4), peak(0.6, 0.9)];
    },
    [...mp4],
  );
  expect(Math.abs(first - 2_000 / 32_767)).toBeLessThan(0.02);
  expect(Math.abs(second - 10_000 / 32_767)).toBeLessThan(0.04);
});
