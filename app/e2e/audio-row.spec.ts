import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// The Audio row is a read-only waveform of the resolved audio mix: it takes
// no files, draws the clips that render audio at their Gain, and recomputes
// on Refresh. Sessions that had a main audio open with it on a source track.
const VIDEO = new URL("./fixtures/test-pattern-audio.webm", import.meta.url);

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

function audioRow(page: Page) {
  return page.locator("[data-audio-row]");
}

function mixContent(page: Page) {
  return audioRow(page).locator("[data-audio-mix]");
}

// The mix's loudest point as the Audio row drew it.
async function drawnLevel(page: Page) {
  return Number(await mixContent(page).getAttribute("data-audio-mix-level"));
}

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

// Drops a test pattern with a loud soundtrack into a new source track. Unlike
// an audio file, a video clip's effects can be edited.
async function addVideoTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern-audio.webm", { type: "video/webm" }),
    );
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

// Records the analysers the preview's mixer makes, which hear the mix.
async function probeAnalysers(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    probe.analysers = [];
    const createAnalyser = AudioContext.prototype.createAnalyser;
    AudioContext.prototype.createAnalyser = function (this: AudioContext) {
      const analyser = createAnalyser.call(this);
      probe.analysers.push(analyser);
      return analyser;
    };
  });
}

// The loudest RMS level of the mix over a few reads.
async function playedLevel(page: Page) {
  let level = 0;
  for (let read = 0; read < 6; read += 1) {
    level = Math.max(
      level,
      await page.evaluate(() => {
        const probe = window as unknown as { analysers: AnalyserNode[] };
        const analyser = probe.analysers.at(-1);
        if (!analyser) {
          return 0;
        }
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        let total = 0;
        for (const sample of samples) {
          total += sample * sample;
        }
        return Math.sqrt(total / samples.length);
      }),
    );
    await page.waitForTimeout(50);
  }
  return level;
}

test("the Audio row takes no files and starts empty", async ({ page }) => {
  await page.goto("/");
  await expect(audioRow(page)).toContainText("No audio");
  await expect(audioRow(page).locator('input[type="file"]')).toHaveCount(0);
  await expect(
    audioRow(page).getByRole("button", { name: "Recompute audio" }),
  ).toBeVisible();
  await expect(
    audioRow(page).getByRole("button", { name: /main audio/i }),
  ).toHaveCount(0);

  await audioRow(page).locator(".track-label").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Audio actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Recompute audio"]);
  await page.keyboard.press("Escape");
});

// How far the Audio row's bottom edge is from the timeline panel's.
async function bottomGap(page: Page) {
  const [panel, row] = await Promise.all([
    page.locator(".timeline-panel").evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.top + node.clientTop + node.clientHeight;
    }),
    audioRow(page).evaluate((node) => node.getBoundingClientRect().bottom),
  ]);
  return Math.abs(panel - row);
}

test("the Audio row is docked at the bottom of the timeline panel at any height", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  const timeline = page.locator(".timeline-scroll");

  // It is not one of the scrolling rows.
  await expect(timeline.locator("[data-audio-row]")).toHaveCount(0);

  // Few rows in a tall panel: the empty space is above it, not below.
  await expect.poll(() => bottomGap(page)).toBeLessThan(1);
  const rowsEnd = await page
    .locator(".source-tracks, [data-timeline-lane-id]")
    .last()
    .evaluate((node) => node.getBoundingClientRect().bottom);
  const rowTop = await audioRow(page).evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  expect(rowTop - rowsEnd).toBeGreaterThan(100);

  // A short panel, under the old 320px pin threshold.
  await page.setViewportSize({ width: 1280, height: 560 });
  await expect
    .poll(() => page.locator(".timeline-panel").evaluate((n) => n.clientHeight))
    .toBeLessThan(320);
  await expect.poll(() => bottomGap(page)).toBeLessThan(1);
  await page.setViewportSize({ width: 1600, height: 1200 });

  // More rows than fit: they scroll above it, never behind or below it.
  const addLayer = page.getByRole("button", { name: "Layer", exact: true });
  while (
    !(await timeline.evaluate((node) => node.scrollHeight > node.clientHeight))
  ) {
    await addLayer.click();
  }
  for (const end of [0, 1]) {
    await timeline.evaluate((node, end) => {
      node.scrollTop = end * node.scrollHeight;
    }, end);
    await expect.poll(() => bottomGap(page)).toBeLessThan(1);
    const [scrollBottom, top] = await Promise.all([
      timeline.evaluate((node) => node.getBoundingClientRect().bottom),
      audioRow(page).evaluate((node) => node.getBoundingClientRect().top),
    ]);
    expect(scrollBottom).toBeLessThanOrEqual(top + 1);
  }
});

test("the Audio row's badge centers its glyph like the layers' badges", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // The glyph's box against the badge's, from each center.
  const glyphOffset = (badge: ReturnType<Page["locator"]>) =>
    badge.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const glyph = range.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return [
        Math.round(glyph.left + glyph.width / 2 - (box.left + box.width / 2)),
        Math.round(glyph.top + glyph.height / 2 - (box.top + box.height / 2)),
      ];
    });
  const audioBadge = audioRow(page).locator(".track-label__index");
  const layerBadge = page.locator(".track-label .track-label__index").first();
  await expect(audioBadge).toHaveText("A");
  const [x, y] = await glyphOffset(audioBadge);
  expect(Math.abs(x)).toBeLessThanOrEqual(1);
  expect([x, y]).toEqual(await glyphOffset(layerBadge));
});

test("the collapsed Audio row stays docked and still draws the waveform", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addVideoTrack(page);
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });

  const toggle = audioRow(page).locator(".audio-row__toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("title", "Collapse audio row");
  const expandedHeight = (await audioRow(page).boundingBox())?.height ?? 0;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("title", "Expand audio row");
  const collapsedHeight = (await audioRow(page).boundingBox())?.height ?? 0;
  expect(collapsedHeight).toBeLessThan(expandedHeight);
  // As short as a collapsed layer (#1057, #1077).
  expect(collapsedHeight).toBe(44);
  await expect.poll(() => bottomGap(page)).toBeLessThan(1);

  // Compact, not hidden: the waveform is drawn at the slim height.
  const canvas = mixContent(page).locator(".waveform__canvas").first();
  await expect(canvas).toBeVisible();
  // Inset 8px, like a collapsed layer's clips.
  const rowTop = (await audioRow(page).boundingBox())?.y ?? 0;
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox?.height).toBe(28);
  expect(Math.abs((canvasBox?.y ?? 0) - rowTop - 8)).toBeLessThanOrEqual(0.5);
  await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);

  // The preference survives a reload.
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => bottomGap(page)).toBeLessThan(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(mixContent(page)).toBeVisible();
});

test("the Audio row's playhead lines up with the timeline playhead", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  const left = (selector: string) =>
    page
      .locator(selector)
      .evaluate((node) => node.getBoundingClientRect().left);
  const offset = async () =>
    (await left("[data-audio-row] .audio-row__playhead")) -
    (await left(".timeline-playhead"));

  // Away from the start too, so a line clamped at the edge can't pass.
  await page
    .locator("[data-timeline-lane-id]")
    .first()
    .click({
      position: { x: 300, y: 10 },
    });
  await expect.poll(() => left(".timeline-playhead")).toBeGreaterThan(300);
  await expect.poll(offset).toBe(0);

  // Zoomed in and scrolled sideways, the Audio row follows the rows.
  const timeline = page.locator(".timeline-scroll");
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect
    .poll(() =>
      timeline.evaluate((node) => node.scrollWidth - node.clientWidth),
    )
    .toBeGreaterThan(200);
  await timeline.evaluate((node) => {
    node.scrollLeft = 150;
  });
  await expect.poll(offset).toBe(0);
  await timeline.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  await expect.poll(offset).toBe(0);
  await timeline.evaluate((node) => {
    node.scrollLeft = 150;
  });

  const toggle = audioRow(page).locator(".audio-row__toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.poll(offset).toBe(0);
});

test("a source clip with audio draws the mix, its muted Gain flattens it, and Refresh recomputes it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addVideoTrack(page);

  await expect(audioRow(page)).toContainText("From source tracks · 1 clip");
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });
  await expect(
    mixContent(page).locator(".waveform__canvas").first(),
  ).toBeVisible();
  await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);

  // Refresh resolves the mix again and draws it anew. The recompute can
  // finish before an assertion polls, so record every state the mix passes
  // through instead of trying to catch the brief "computing" one.
  await mixContent(page).evaluate((node) => {
    const probe = window as unknown as { leftMixStates: string[] };
    probe.leftMixStates = [];
    new MutationObserver((records) => {
      for (const record of records) {
        probe.leftMixStates.push(record.oldValue ?? "");
      }
    }).observe(node, {
      attributeFilter: ["data-audio-mix"],
      attributeOldValue: true,
    });
  });
  await audioRow(page).getByRole("button", { name: "Recompute audio" }).click();
  // The mix left "ready" to compute, then left "computing" for "ready".
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { leftMixStates: string[] }).leftMixStates,
        ),
      { timeout: 30_000 },
    )
    .toEqual(["ready", "computing"]);
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready");
  await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);

  // Muting the clip's Gain flattens its waveform.
  await page.locator(".source-span").first().click();
  const clipGain = page.locator('.fx-chain [data-fx-group="clip"]');
  await clipGain.getByRole("button", { name: /^Mute / }).click();
  await expect(
    clipGain.getByRole("button", { name: /^Mute / }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });
  await expect.poll(() => drawnLevel(page)).toBe(0);
  // The muted clip still counts toward the mix.
  await expect(audioRow(page)).toContainText("From source tracks · 1 clip");
});

// The pixels the Audio row's waveform canvas holds.
function drawnPixels(page: Page) {
  return mixContent(page)
    .locator(".waveform__canvas")
    .first()
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
}

test("the Audio row redraws when the Gain changes, a clip moves, or it collapses", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await addVideoTrack(page);
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
    timeout: 30_000,
  });
  await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);
  const loudLevel = await drawnLevel(page);
  const loudPixels = await drawnPixels(page);

  // Turning the clip's Gain down draws it quieter.
  const span = page.locator(".source-span").first();
  await span.click();
  const fader = page
    .locator('.fx-chain .fx-device-panel[data-fx-group="clip"]')
    .getByRole("slider", { name: "Gain" });
  for (let step = 0; step < 12; step += 1) {
    await fader.press("ArrowDown");
  }
  await expect(fader).not.toHaveAttribute("aria-valuetext", "0.0 dB");
  await expect
    .poll(() => drawnLevel(page), { timeout: 30_000 })
    .toBeLessThan(loudLevel * 0.9);
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready");
  await expect.poll(() => drawnPixels(page)).not.toBe(loudPixels);
  const quietLevel = await drawnLevel(page);
  const quietPixels = await drawnPixels(page);

  // Moving the clip later draws it later, at the same level.
  const body = span.locator(".source-span__body");
  const bounds = await body.boundingBox();
  if (!bounds) throw new Error("no source clip box");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await span.boundingBox())?.x ?? 0)
    .toBeGreaterThan(bounds.x + 100);
  await expect
    .poll(() => drawnPixels(page), { timeout: 30_000 })
    .not.toBe(quietPixels);
  await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready");
  expect(await drawnLevel(page)).toBeCloseTo(quietLevel, 2);

  // Collapsing redraws the canvas at its new height rather than squashing
  // the expanded drawing.
  const canvas = mixContent(page).locator(".waveform__canvas").first();
  const drawnAtItsHeight = () =>
    canvas.evaluate(
      (node) =>
        (node as HTMLCanvasElement).height ===
        Math.round(node.clientHeight * (window.devicePixelRatio || 1)),
    );
  const expandedHeight = await canvas.evaluate(
    (node) => (node as HTMLCanvasElement).height,
  );
  await audioRow(page).locator(".audio-row__toggle").click();
  await expect.poll(drawnAtItsHeight).toBe(true);
  expect(
    await canvas.evaluate((node) => (node as HTMLCanvasElement).height),
  ).toBeLessThan(expandedHeight);
});

test("a session with a main audio opens with it on a new source track, which plays", async ({
  page,
}) => {
  await probeAnalysers(page);
  const folder = await mkdtemp(join(tmpdir(), "zvid-main-audio-"));
  try {
    await writeFile(join(folder, "Song.wav"), toneWav(3));
    await writeFile(
      join(folder, "Old Song.lvp"),
      JSON.stringify({
        timeline: { bpm: 120, fps: 30, projectDuration: 90 },
        mainTracks: [{ id: "1", name: "Layer 1" }],
        tracks: [],
        clips: [],
        selections: [],
        effects: [],
        audioFilename: "Song.wav",
      }),
    );

    await page.goto("/");
    await page.getByRole("menuitem", { name: "File", exact: true }).click();
    const choosingSession = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Open", exact: true }).click();
    await page.getByRole("menuitem", { name: "Session…", exact: true }).click();
    await (await choosingSession).setFiles(join(folder, "Old Song.lvp"));

    // A lone session file carries no media, so locate the main audio.
    await page.locator(".track-label__offline").click();
    const offlineMedia = page.getByRole("dialog", { name: "Offline Media" });
    const choosingMedia = page.waitForEvent("filechooser");
    await offlineMedia.getByRole("button", { name: "Locate Files…" }).click();
    await (await choosingMedia).setFiles(join(folder, "Song.wav"));
    await expect(page.locator(".track-label__offline")).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.keyboard.press("Escape");

    // The main audio is now a source track named after its file, with one
    // clip, and the Audio row draws it.
    await expect(page.locator(".track-label--source")).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.locator(".track-label--source")).toContainText("Song");
    await expect(page.locator(".source-span")).toHaveCount(1);
    await expect(audioRow(page)).toContainText("From source tracks · 1 clip");
    await expect(mixContent(page)).toHaveAttribute("data-audio-mix", "ready", {
      timeout: 30_000,
    });
    await expect.poll(() => drawnLevel(page)).toBeGreaterThan(0.1);

    // It plays through its 0 dB Gain.
    await page.getByRole("button", { name: "Play timeline" }).click();
    await expect
      .poll(() => playedLevel(page), { timeout: 15_000 })
      .toBeGreaterThan(0.02);
    await page.getByRole("button", { name: "Pause playback" }).click();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
