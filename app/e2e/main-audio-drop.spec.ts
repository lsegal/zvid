import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Dropping a file from the desktop on the Audio lane sets the main audio when
// it is audio, and is refused with a status message when it is not.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);
const LANE = "[data-main-audio-drop-target]";

// A one-second 440 Hz mono WAV. Its MIME type is left empty, as browsers
// report for some audio files, so the drop is validated by its extension.
function toneTransfer(page: Page) {
  return page.evaluateHandle(() => {
    const sampleRate = 8000;
    const samples = sampleRate;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, samples * 2, true);
    for (let index = 0; index < samples; index += 1) {
      const value = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
      view.setInt16(44 + index * 2, value * 0x5fff, true);
    }

    const transfer = new DataTransfer();
    transfer.items.add(new File([buffer], "tone.wav", { type: "" }));
    return transfer;
  });
}

async function videoTransfer(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  return page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
}

// Browsers hide dragged files' names during dragenter/dragover, often report
// an empty MIME type (for example for .flac or .aiff), and Safari may expose
// no items at all, so these events carry only what a real OS drag shows: the
// "Files" type and, optionally, file items with the given MIME types.
async function dragOverLane(page: Page, itemTypes: string[] | null) {
  for (const type of ["dragenter", "dragover"]) {
    await page.locator(LANE).evaluate(
      (lane, { type, itemTypes }) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", {
          value: {
            types: ["Files"],
            files: [],
            items: (itemTypes ?? []).map((itemType) => ({
              kind: "file",
              type: itemType,
            })),
            dropEffect: "none",
            effectAllowed: "all",
          },
        });
        lane.dispatchEvent(event);
      },
      { type, itemTypes },
    );
  }
}

test("dropping an audio file on the Audio lane sets the main audio", async ({
  page,
}) => {
  await page.goto("/");
  const lane = page.locator(LANE);
  await expect(lane.locator(".track-label small")).toHaveText("No main audio");

  await dragOverLane(page, [""]);
  await expect(lane).toHaveClass(/is-drop-target/);

  const dataTransfer = await toneTransfer(page);
  await page.dispatchEvent(LANE, "drop", { dataTransfer });
  await expect(lane).not.toHaveClass(/is-drop-target/);
  await expect(lane.locator(".track-label small")).toHaveText("tone.wav", {
    timeout: 30_000,
  });
  await expect(lane.locator(".waveform__canvas")).toBeVisible({
    timeout: 30_000,
  });
});

test("dropping a video file on the Audio lane is refused", async ({ page }) => {
  await page.goto("/");
  const lane = page.locator(LANE);
  await expect(lane.locator(".track-label small")).toHaveText("No main audio");

  await dragOverLane(page, ["video/mp4"]);
  await expect(lane).not.toHaveClass(/is-drop-target/);

  const dataTransfer = await videoTransfer(page);
  await page.dispatchEvent(LANE, "drop", { dataTransfer });
  await expect(
    page.getByText("Only audio files can be dropped on the Audio lane."),
  ).toBeVisible();
  await expect(lane.locator(".track-label small")).toHaveText("No main audio");
  await expect(page.locator(".source-span")).toHaveCount(0);
});

test("a file drag that exposes no items highlights the Audio lane until it leaves", async ({
  page,
}) => {
  await page.goto("/");
  const lane = page.locator(LANE);
  await dragOverLane(page, null);
  await expect(lane).toHaveClass(/is-drop-target/);

  const dataTransfer = await toneTransfer(page);
  await page.dispatchEvent(LANE, "dragleave", { dataTransfer });
  await expect(lane).not.toHaveClass(/is-drop-target/);
});
