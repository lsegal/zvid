import { expect, type Locator, type Page, test } from "@playwright/test";

// Committing a selection that covers several clips on a source track makes
// a layer clip for each of them, split at their edges, so every covered
// clip draws its waveform and plays in the mix, not only the first (#817).

test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Records the analysers the preview's mixer makes, which measure the mix.
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
  return wav.toString("base64");
}

// Drops three two-second tones into one new source track, back to back.
async function dropThreeTones(page: Page) {
  const files = ["a", "b", "c"].map((name) => ({
    name: `tone-${name}.wav`,
    base64: toneWav(2),
  }));
  const dataTransfer = await page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const { name, base64 } of files) {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], name, { type: "audio/wav" }));
    }
    return transfer;
  }, files);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(3, {
    timeout: 30_000,
  });
}

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// The [left, right] edges of each element, in page pixels, left to right.
function edges(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements
      .map((element) => element.getBoundingClientRect())
      .map((rect) => [rect.left, rect.right])
      .toSorted((a, b) => a[0] - b[0]),
  );
}

// How many columns of a waveform canvas have anything drawn in them.
function drawnColumns(canvas: Locator) {
  return canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) {
      return 0;
    }
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let columns = 0;
    for (let x = 0; x < canvas.width; x += 1) {
      for (let y = 0; y < canvas.height; y += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          columns += 1;
          break;
        }
      }
    }
    return columns;
  });
}

// Plays from the session start and returns the loudest mix level heard
// while the playhead was inside each [left, right] range, in page pixels.
async function levelsWhilePlaying(page: Page, ranges: number[][]) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  const sampling = page.evaluate(
    (ranges) =>
      new Promise<number[]>((resolve) => {
        const probe = window as unknown as { analysers: AnalyserNode[] };
        const levels = ranges.map(() => 0);
        const startedAt = performance.now();
        const read = () => {
          const analyser = probe.analysers.at(-1);
          const marker = document.querySelector(".timeline-playhead-marker");
          if (analyser && marker) {
            const x = marker.getBoundingClientRect().left;
            const samples = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(samples);
            let total = 0;
            for (const sample of samples) {
              total += sample * sample;
            }
            const level = Math.sqrt(total / samples.length);
            ranges.forEach(([left, right], index) => {
              if (x > left && x < right) {
                levels[index] = Math.max(levels[index], level);
              }
            });
          }
          if (performance.now() - startedAt < 9_000) {
            requestAnimationFrame(read);
          } else {
            resolve(levels);
          }
        };
        requestAnimationFrame(read);
      }),
    ranges,
  );
  await page.getByRole("button", { name: "Play timeline" }).click();
  return sampling;
}

test("a selection over three source clips commits a clip on each", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(lane(page, "1")).toBeVisible();
  await dropThreeTones(page);

  // Layer 1 centered vertically, at the song start, so it lines up with the
  // source clips below it.
  const layer = lane(page, "1");
  await layer.evaluate(
    (element) =>
      new Promise((resolve) => {
        element.scrollIntoView({ block: "center" });
        const scroller = element.closest(".timeline-scroll");
        if (scroller) {
          scroller.scrollLeft = 0;
        }
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  const spans = await edges(page.locator(".source-span"));
  // Back to back on one track.
  expect(spans[1][0] - spans[0][1]).toBeLessThan(2);
  expect(spans[2][0] - spans[1][1]).toBeLessThan(2);

  // From inside the first source clip to inside the last.
  const bounds = await layer.boundingBox();
  if (!bounds) {
    throw new Error("Layer 1 is not visible");
  }
  const fromX = spans[0][0] + (spans[0][1] - spans[0][0]) / 4;
  const toX = spans[2][1] - (spans[2][1] - spans[2][0]) / 4;
  const y = bounds.y + 20;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 6 });
  await page.mouse.up();
  const selection = layer.locator(".timeline-selection");
  await expect(selection).toBeVisible();
  const selected = await selection.boundingBox();
  if (!selected) {
    throw new Error("Selection is not visible");
  }
  await page.keyboard.press("1");

  // One clip per source clip, split at the source clip edges, together
  // covering the whole selection.
  const clips = layer.locator(".clip-card");
  await expect(clips).toHaveCount(3);
  const clipEdges = await edges(clips);
  expect(Math.abs(clipEdges[0][0] - selected.x)).toBeLessThan(2);
  expect(Math.abs(clipEdges[0][1] - spans[0][1])).toBeLessThan(2);
  expect(Math.abs(clipEdges[1][0] - spans[1][0])).toBeLessThan(2);
  expect(Math.abs(clipEdges[1][1] - spans[1][1])).toBeLessThan(2);
  expect(Math.abs(clipEdges[2][0] - spans[2][0])).toBeLessThan(2);
  expect(
    Math.abs(clipEdges[2][1] - (selected.x + selected.width)),
  ).toBeLessThan(2);

  // Each draws its waveform across its whole width.
  for (let index = 0; index < 3; index += 1) {
    const waveform = clips.nth(index).locator("canvas.clip-card__waveform");
    await expect(waveform).toHaveCount(1);
    await expect
      .poll(async () => {
        const width = await waveform.evaluate(
          (element) => (element as HTMLCanvasElement).width,
        );
        return width > 0 && (await drawnColumns(waveform)) > width * 0.8;
      })
      .toBe(true);
  }

  // The mix hears every source clip's range, not only the first.
  const levels = await levelsWhilePlaying(page, clipEdges);
  for (const level of levels) {
    expect(level).toBeGreaterThan(0.05);
  }
});
