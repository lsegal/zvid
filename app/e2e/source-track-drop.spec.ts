import { readFile } from "node:fs/promises";
import { expect, type JSHandle, type Page, test } from "@playwright/test";

// Dropping audio and video files from the OS onto the source tracks: onto a
// track adds them to it, and onto the header or the new-track row (the
// [ + Track ] placeholder) creates a track.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);
const AUDIO = new URL("./fixtures/tone.wav", import.meta.url);

type DroppedFile = { name: string; type: string; base64: string };

const video = async (): Promise<DroppedFile> => ({
  name: "test-pattern.mp4",
  type: "video/mp4",
  base64: (await readFile(VIDEO)).toString("base64"),
});
const audio = async (): Promise<DroppedFile> => ({
  name: "tone.wav",
  type: "audio/wav",
  base64: (await readFile(AUDIO)).toString("base64"),
});

async function dataTransferOf(page: Page, files: DroppedFile[]) {
  return page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const { name, type, base64 } of files) {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], name, { type }));
    }
    return transfer;
  }, files);
}

async function drag(
  page: Page,
  selector: string,
  dataTransfer: JSHandle<DataTransfer>,
  types = ["dragenter", "dragover"],
) {
  for (const type of types) {
    await page.dispatchEvent(selector, type, { dataTransfer });
  }
}

async function drop(
  page: Page,
  selector: string,
  dataTransfer: JSHandle<DataTransfer>,
) {
  await drag(page, selector, dataTransfer, ["dragenter", "dragover", "drop"]);
}

const header = '[aria-label="Source track drop area"]';
const tracks = '[data-source-track-drop-target="track"]';
const newTrackRow = ".track-row--source-drop";
// The new-track row while it takes a drag, rather than showing [ + Track ].
const newTrackDropRow = ".track-placeholder--drag";

async function dropIntoNewTrack(page: Page, files: DroppedFile[]) {
  await drop(page, header, await dataTransferOf(page, files));
  await expect(page.locator(tracks)).toHaveCount(1);
  await expect(page.locator(".source-span")).toHaveCount(files.length, {
    timeout: 30_000,
  });
}

test("dropping on an existing track's label adds to that track", async ({
  page,
}) => {
  await page.goto("/");
  await dropIntoNewTrack(page, [await video()]);

  await drop(
    page,
    `${tracks} .track-label--source`,
    await dataTransferOf(page, [await audio()]),
  );

  await expect(page.locator(".source-span")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(page.locator(tracks)).toHaveCount(1);
  await expect(page.locator(newTrackDropRow)).toHaveCount(0);
});

test("dropping on a track's clips adds to that track", async ({ page }) => {
  await page.goto("/");
  await dropIntoNewTrack(page, [await video()]);

  await drop(
    page,
    `${tracks} .source-span`,
    await dataTransferOf(page, [await audio()]),
  );

  await expect(page.locator(".source-span")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(page.locator(tracks)).toHaveCount(1);
});

test("dropping on the new-track row creates a track", async ({ page }) => {
  await page.goto("/");
  await dropIntoNewTrack(page, [await video()]);

  const dataTransfer = await dataTransferOf(page, [await audio()]);
  await drag(page, tracks, dataTransfer);
  await expect(page.locator(newTrackDropRow)).toBeVisible();
  await expect(page.locator(`${tracks} .is-drop-target`)).toHaveCount(1);
  await drop(page, newTrackRow, dataTransfer);

  await expect(page.locator(tracks)).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator(".source-span")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(page.locator(newTrackDropRow)).toHaveCount(0);
});

test("dropping two files imports both into one track", async ({ page }) => {
  await page.goto("/");
  await dropIntoNewTrack(page, [await video(), await audio()]);

  await expect(page.locator(tracks)).toHaveCount(1);
});

test("dropping a non-media file changes nothing", async ({ page }) => {
  await page.goto("/");
  await drop(
    page,
    header,
    await dataTransferOf(page, [
      { name: "notes.txt", type: "text/plain", base64: btoa("notes") },
    ]),
  );

  await expect(
    page.getByText(
      "Only audio and video files can be dropped on source tracks.",
    ),
  ).toBeVisible();
  await expect(page.locator(tracks)).toHaveCount(0);
  await expect(page.locator(".source-span")).toHaveCount(0);
});
