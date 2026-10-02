import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// The transport bar's stereo VU meter, left of the preview volume, meters
// the program mix (the clips' audio mix) before the preview volume, and
// decays to empty when playback stops.
const AUDIO = new URL("./fixtures/tone.wav", import.meta.url);
const DROP_AREA = '[aria-label="Source track drop area"]';
const SILENT = "−∞";

function readout(page: Page) {
  return page.locator(".vu-meter__readout");
}

function channel(page: Page, name: "Left level" | "Right level") {
  return page.getByRole("meter", { name });
}

async function level(page: Page, name: "Left level" | "Right level") {
  return Number(await channel(page, name).getAttribute("aria-valuenow"));
}

async function readoutDb(page: Page) {
  const text = (await readout(page).textContent()) ?? "";
  return text === SILENT ? -Infinity : Number(text.replace("−", "-"));
}

// The fixture is a three-second mono tone at about -18 dBFS. Dropped on
// the source tracks, it plays as a source clip with a 0 dB Gain.
async function addSourceAudio(page: Page) {
  const base64 = (await readFile(AUDIO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "tone.wav", { type: "audio/wav" }));
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(DROP_AREA, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

test.use({ viewport: { width: 1600, height: 900 } });

test("the meter sits left of the volume control and starts empty", async ({
  page,
}) => {
  await page.goto("/");
  const meter = await page.locator(".vu-meter").boundingBox();
  const mute = await page
    .getByRole("button", { name: "Mute preview" })
    .boundingBox();
  if (!meter || !mute) {
    throw new Error("The meter or the mute button is not visible");
  }
  expect(meter.x + meter.width).toBeLessThanOrEqual(mute.x);
  expect(
    Math.abs(meter.y + meter.height / 2 - (mute.y + mute.height / 2)),
  ).toBeLessThan(2);

  for (const name of ["Left level", "Right level"] as const) {
    await expect(channel(page, name)).toHaveAttribute("aria-valuemin", "-60");
    await expect(channel(page, name)).toHaveAttribute("aria-valuemax", "6");
    await expect(channel(page, name)).toHaveAttribute("aria-valuenow", "-60");
  }
  await expect(readout(page)).toHaveText(SILENT);
  await expect(readout(page)).toHaveAttribute("aria-live", "off");
});

test("the meter reads the audio mix regardless of the preview volume", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addSourceAudio(page);

  await page.getByRole("button", { name: "Play timeline" }).click();
  // Both bars fill from the mono tone, and the readout shows its level.
  await expect.poll(() => level(page, "Left level")).toBeGreaterThan(-30);
  await expect.poll(() => level(page, "Right level")).toBeGreaterThan(-30);
  await expect.poll(() => readoutDb(page)).toBeGreaterThan(-30);
  const audible = await readoutDb(page);
  expect(audible).toBeLessThan(0);

  // Silencing the preview leaves the program level alone.
  await page.getByRole("slider", { name: "Preview volume" }).fill("0");
  await page.waitForTimeout(400);
  expect(Math.abs((await readoutDb(page)) - audible)).toBeLessThan(1.5);
  expect(await level(page, "Left level")).toBeGreaterThan(-30);

  await page.getByRole("button", { name: "Pause playback" }).click();
  await expect(readout(page)).toHaveText(SILENT, { timeout: 10_000 });
  await expect(channel(page, "Left level")).toHaveAttribute(
    "aria-valuenow",
    "-60",
    { timeout: 10_000 },
  );
  await expect(page.locator(".vu-meter__channel.has-peak")).toHaveCount(0, {
    timeout: 10_000,
  });
});

test("the meter hides before the volume slider in a narrow bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("slider", { name: "Preview volume" }),
  ).toBeVisible();

  // Wherever the meter shows, it never pushes into the transport buttons.
  for (const width of [1440, 1280, 1180, 1100, 1024, 960, 901]) {
    await page.setViewportSize({ width, height: 900 });
    const cluster = await page.locator(".transport-cluster").boundingBox();
    const volume = await page.locator(".volume-control").boundingBox();
    if (!cluster || !volume) {
      throw new Error(`The transport bar is not laid out at ${width}px`);
    }
    expect(volume.x, `at ${width}px`).toBeGreaterThanOrEqual(
      cluster.x + cluster.width,
    );
  }

  await page.setViewportSize({ width: 375, height: 740 });
  await expect(page.locator(".vu-meter")).toBeHidden();
  await expect(
    page.getByRole("slider", { name: "Preview volume" }),
  ).toBeVisible();
});
