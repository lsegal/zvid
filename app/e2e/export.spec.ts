import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Returns the payload of the first `type` box in data[start, end).
function findBox(
  data: Buffer,
  start: number,
  end: number,
  type: string,
): { start: number; end: number } | null {
  let offset = start;
  while (offset + 8 <= end) {
    // A 32-bit size of 1 means a 64-bit size follows the type.
    const extended = data.readUInt32BE(offset) === 1;
    const header = extended ? 16 : 8;
    const size = extended
      ? Number(data.readBigUInt64BE(offset + 8))
      : data.readUInt32BE(offset);
    if (size < header || offset + size > end) return null;
    if (data.toString("latin1", offset + 4, offset + 8) === type)
      return { start: offset + header, end: offset + size };
    offset += size;
  }
  return null;
}

// Reads moov/udta/meta/ilst/covr/data, the iTunes-style cover art that file
// browsers show as the thumbnail.
function readCoverArt(mp4: Buffer): { dataType: number; image: Buffer } {
  let box = { start: 0, end: mp4.length };
  for (const type of ["moov", "udta", "meta", "ilst", "covr", "data"]) {
    const next = findBox(mp4, box.start, box.end, type);
    if (!next) throw new Error(`MP4 has no ${type} box on the cover path`);
    // meta is a full box: skip its version and flags.
    box = type === "meta" ? { ...next, start: next.start + 4 } : next;
  }
  return {
    dataType: mp4.readUInt32BE(box.start),
    // data payload: type indicator (4 bytes), locale (4 bytes), image.
    image: mp4.subarray(box.start + 8, box.end),
  };
}

test("the web export embeds a JPEG thumbnail of the output", async ({
  page,
}) => {
  await page.goto("/export-smoke.html");
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.click("#video");
  const mp4 = await readFile(await (await download).path());
  await expect(page.locator("#status")).toContainText(
    "Saved smoke-video-only.mp4",
  );

  const cover = readCoverArt(mp4);
  expect(cover.dataType).toBe(13); // JPEG
  expect([...cover.image.subarray(0, 2)]).toEqual([0xff, 0xd8]);

  // The smoke page renders 320x180 frames: a blue background with the frame
  // number in white.
  const picture = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable.");
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        corner: [...context.getImageData(4, 4, 1, 1).data.slice(0, 3)],
      };
    },
    [...cover.image],
  );
  expect(picture.width).toBe(320);
  expect(picture.height).toBe(180);
  const [red, green, blue] = picture.corner;
  expect(Math.abs(red - 0x24)).toBeLessThan(16);
  expect(Math.abs(green - 0x50)).toBeLessThan(16);
  expect(Math.abs(blue - 0x78)).toBeLessThan(16);
});
