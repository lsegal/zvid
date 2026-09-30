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

// The sample entry type (e.g. "avc1", "mp4a") and, for audio, the sample
// rate of each track, from moov/trak/mdia/minf/stbl/stsd.
function readSampleEntries(mp4: Buffer) {
  const moov = findBox(mp4, 0, mp4.length, "moov");
  if (!moov) throw new Error("MP4 has no moov box");
  const entries: { type: string; sampleRate?: number }[] = [];
  let offset = moov.start;
  for (;;) {
    const trak = findBox(mp4, offset, moov.end, "trak");
    if (!trak) return entries;
    let box = trak;
    for (const type of ["mdia", "minf", "stbl", "stsd"]) {
      const next = findBox(mp4, box.start, box.end, type);
      if (!next) throw new Error(`MP4 track has no ${type} box`);
      box = next;
    }
    // stsd: version and flags, entry count, then the first sample entry.
    const entry = box.start + 8;
    const type = mp4.toString("latin1", entry + 4, entry + 8);
    entries.push(
      type === "mp4a"
        ? // AudioSampleEntry: 16.16 fixed-point rate after 24 bytes.
          { type, sampleRate: mp4.readUInt32BE(entry + 8 + 24) >>> 16 }
        : { type },
    );
    offset = trak.end;
  }
}

test("the web export uses the Session Settings codec, bitrate and audio", async ({
  page,
}) => {
  await page.goto(
    "/export-smoke.html?codec=h264&mbps=2&audioKbps=128&sampleRate=44100",
  );
  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.click("#audio");
  // Wait on the status so a failed export reports its error.
  await expect(page.locator("#status")).toContainText(
    "Saved smoke-audible.mp4",
    { timeout: 120_000 },
  );
  await expect(page.locator("#status")).toContainText(
    "320×180 · 24 fps · H.264 · 2 Mbps",
  );
  const mp4 = await readFile(await (await download).path());
  expect(readSampleEntries(mp4)).toEqual([
    { type: "avc1" },
    { type: "mp4a", sampleRate: 44_100 },
  ]);
});

test("an unsupported Session Settings codec fails early and suggests Auto", async ({
  page,
}) => {
  // Report no HEVC encoder, whatever the machine has.
  await page.addInitScript(() => {
    const isConfigSupported = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async (config) =>
      /^(hev|hvc)1/.test(config.codec)
        ? { supported: false, config }
        : isConfigSupported(config);
  });
  await page.goto("/export-smoke.html?codec=hevc");
  await page.click("#video");
  await expect(page.locator("#status")).toContainText(
    "HEVC encoding at 320×180 is not supported on this device. Choose Auto in Session Settings",
  );
});
