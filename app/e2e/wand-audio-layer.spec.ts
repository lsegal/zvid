import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The arrangement wand builds its video layers from video sources only and
// puts audio-only sources on a separate Audio layer after them. A song that
// runs the whole arrangement becomes one uncut clip there.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

test.describe.configure({ timeout: 90_000 });

// A 440 Hz tone as a 16-bit mono WAV.
function toneWav(seconds: number) {
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
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 10_000), 44 + index * 2);
  }
  return wav;
}

async function dropIntoNewSourceTrack(
  page: Page,
  bytes: Buffer,
  name: string,
  type: string,
) {
  const dataTransfer = await page.evaluateHandle(
    ({ base64, name, type }) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], name, { type }));
      return transfer;
    },
    { base64: bytes.toString("base64"), name, type },
  );
  const target = '[data-source-track-drop-target="new-track"]';
  for (const event of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, event, { dataTransfer });
  }
}

test("the wand adds an Audio layer holding a full-length song uncut", async ({
  page,
}) => {
  await page.goto("/");
  await dropIntoNewSourceTrack(
    page,
    await readFile(VIDEO),
    "test-pattern.mp4",
    "video/mp4",
  );
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  // The song outlasts the four-second video.
  await dropIntoNewSourceTrack(page, toneWav(10), "Song.wav", "audio/wav");
  await expect(page.locator(".source-span--audio")).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Randomize arrangement" }).click();

  const labels = page.locator("[data-lane-label-id]");
  await expect(labels.locator("span")).toHaveText([
    "Layer 1",
    "Layer 2",
    "Layer 3",
    "Audio",
  ]);
  const audioLaneId = await labels.last().getAttribute("data-lane-label-id");
  const audioClips = page.locator(
    `[data-timeline-lane-id="${audioLaneId}"] .clip-card`,
  );
  await expect(audioClips).toHaveCount(1);
  await expect(audioClips).toHaveClass(/clip-card--audio/);

  // No video layer holds a clip from the song.
  for (const label of (await labels.all()).slice(0, -1)) {
    const laneId = await label.getAttribute("data-lane-label-id");
    await expect(
      page.locator(`[data-timeline-lane-id="${laneId}"] .clip-card--audio`),
    ).toHaveCount(0);
  }
});
