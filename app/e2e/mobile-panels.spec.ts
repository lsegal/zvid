import { devices, expect, type Page, test } from "@playwright/test";

// The phone shell's preview header, transport VU meter and status toast
// (#1177): the desktop pieces the phone layout used to hide outright.
const { defaultBrowserType: _, ...PHONE } = devices["Pixel 7"];

test.use({ ...PHONE, viewport: { width: 375, height: 667 } });

type Box = { top: number; bottom: number; left: number; right: number };

async function boxes(page: Page, selectors: Record<string, string>) {
  return page.evaluate((entries) => {
    const result: Record<string, Box | null> = {};
    for (const [key, selector] of Object.entries(entries)) {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      result[key] = rect
        ? {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
          }
        : null;
    }
    return result;
  }, selectors);
}

function overlaps(a: Box | null, b: Box | null) {
  return Boolean(
    a &&
      b &&
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom,
  );
}

async function pageScrolls(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollHeight > window.innerHeight ||
      document.documentElement.scrollWidth > window.innerWidth,
  );
}

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

test("Scopes and Audio open under the preview with no page scroll", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveClass(/app-shell--phone/);
  const header = page.locator(".preview-panel__header");
  await expect(header).toBeVisible();
  const scopes = header.getByRole("button", { name: "Scopes" });
  const audio = header.getByRole("button", { name: "Audio" });
  await scopes.click();
  await audio.click();
  await expect(page.getByRole("region", { name: "Scopes" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Audio analysis" }),
  ).toBeVisible();

  expect(await pageScrolls(page)).toBe(false);
  const layout = await boxes(page, {
    header: ".preview-panel__header",
    monitor: ".preview-monitor",
    scopes: ".scopes-pane",
    audio: ".audio-analysis",
    transport: ".mobile-transport",
    timeline: ".timeline-panel",
    tabs: ".mobile-tab-bar",
  });
  // Header, monitor, then the panes side by side, all above the transport.
  expect(layout.header?.bottom).toBeLessThanOrEqual(layout.monitor?.top ?? 0);
  expect(layout.monitor?.bottom).toBeLessThanOrEqual(layout.scopes?.top ?? 0);
  expect(layout.scopes?.top).toBe(layout.audio?.top);
  expect(overlaps(layout.scopes, layout.audio)).toBe(false);
  for (const pane of [layout.scopes, layout.audio]) {
    expect(pane?.bottom).toBeLessThanOrEqual(layout.transport?.top ?? 0);
    expect(pane?.right).toBeLessThanOrEqual(375);
  }
  expect(layout.transport?.bottom).toBeLessThanOrEqual(
    layout.timeline?.top ?? 0,
  );
  // The timeline keeps room to work in.
  expect(
    (layout.timeline?.bottom ?? 0) - (layout.timeline?.top ?? 0),
  ).toBeGreaterThan(100);
  expect(layout.timeline?.bottom).toBeLessThanOrEqual(layout.tabs?.top ?? 0);

  await scopes.click();
  await audio.click();
  await expect(page.getByRole("region", { name: "Scopes" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Audio analysis" }),
  ).toHaveCount(0);
});

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
  const layout = await boxes(page, {
    meter: ".mobile-transport .vu-meter",
    transport: ".mobile-transport",
    timeline: ".timeline-panel",
  });
  expect(layout.meter?.bottom).toBeLessThanOrEqual(
    layout.transport?.bottom ?? 0,
  );
  expect(layout.meter?.right).toBeLessThanOrEqual(375);
  expect(await pageScrolls(page)).toBe(false);
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
  await page.getByRole("button", { name: "Close media" }).click();
  const layout = await boxes(page, {
    toast: ".status-bar__message",
    transport: ".mobile-transport",
    tabs: ".mobile-tab-bar",
  });
  expect(overlaps(layout.toast, layout.transport)).toBe(false);
  expect(overlaps(layout.toast, layout.tabs)).toBe(false);
  expect(layout.toast?.left).toBeGreaterThanOrEqual(0);
  expect(layout.toast?.right).toBeLessThanOrEqual(375);
  expect(await pageScrolls(page)).toBe(false);
});

test.describe("landscape phone", () => {
  test.use({ viewport: { width: 915, height: 412 } });

  test("keeps the panes and VU meter beside the timeline", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-shell")).toHaveClass(
      /app-shell--phone-landscape/,
    );
    const header = page.locator(".preview-panel__header");
    await header.getByRole("button", { name: "Scopes" }).click();
    await header.getByRole("button", { name: "Audio" }).click();
    await expect(transportLevel(page)).toBeVisible();
    expect(await pageScrolls(page)).toBe(false);
    const layout = await boxes(page, {
      monitor: ".preview-monitor",
      scopes: ".scopes-pane",
      audio: ".audio-analysis",
      transport: ".mobile-transport",
      timeline: ".timeline-panel",
    });
    expect(
      (layout.monitor?.bottom ?? 0) - (layout.monitor?.top ?? 0),
    ).toBeGreaterThan(60);
    for (const pane of [layout.monitor, layout.scopes, layout.audio]) {
      expect(pane?.bottom).toBeLessThanOrEqual(layout.transport?.top ?? 0);
      expect(pane?.right).toBeLessThanOrEqual(layout.timeline?.left ?? 0);
    }
  });
});
