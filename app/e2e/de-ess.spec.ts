import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// The De-ess audio effect: added from a clip's add menu, in its Audio
// group, with its controls at their defaults, and turning down the
// sibilant band of what the preview mix plays.
test.use({ viewport: { width: 1600, height: 1200 } });
test.describe.configure({ timeout: 90_000 });

// Records the analysers the preview's mixer makes, which measure the mix
// after every clip's effects.
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

// The mix's RMS level over the analyser's latest window, and the share of
// its spectrum's power above 3 kHz, where only the 6 kHz "sibilance" of
// the test sound lies.
function mixReading(page: Page) {
  return page.evaluate(() => {
    const probe = window as unknown as { analysers: AnalyserNode[] };
    const analyser = probe.analysers.at(-1);
    if (!analyser) {
      return { level: 0, sibilance: 0 };
    }
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let total = 0;
    for (const sample of samples) {
      total += sample * sample;
    }
    const bins = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(bins);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    let all = 0;
    let high = 0;
    bins.forEach((db, bin) => {
      const power = 10 ** (db / 10);
      all += power;
      if (bin * binHz > 3000) {
        high += power;
      }
    });
    return {
      level: Math.sqrt(total / samples.length),
      sibilance: all > 0 ? high / all : 0,
    };
  });
}

// The steadiest reading over a few reads, so a read between buffers
// doesn't count.
async function settledReading(page: Page) {
  let best = { level: 0, sibilance: 0 };
  for (let read = 0; read < 6; read += 1) {
    const reading = await mixReading(page);
    if (reading.level > best.level) {
      best = reading;
    }
    await page.waitForTimeout(50);
  }
  return best;
}

// A 300 Hz tone and a 6 kHz tone, each at 0.1, as a 16-bit mono WAV.
function sibilantWav(seconds: number) {
  const sampleRate = 48_000;
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
    const t = index / sampleRate;
    const sample =
      0.1 * Math.sin(2 * Math.PI * 300 * t) +
      0.1 * Math.sin(2 * Math.PI * 6000 * t);
    wav.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return wav.toString("base64");
}

async function addSound(page: Page, seconds: number) {
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "ess.wav", { type: "audio/wav" }));
    return transfer;
  }, sibilantWav(seconds));
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent('[aria-label="Source track drop area"]', type, {
      dataTransfer,
    });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

async function playFromStart(page: Page) {
  for (let bar = 0; bar < 2; bar += 1) {
    await page.getByRole("button", { name: "Jump back one bar" }).click();
  }
  await page.getByRole("button", { name: "Play timeline" }).click();
}

const deEssDevice = (page: Page) =>
  page.locator(
    '.fx-chain .fx-device-panel[data-fx-group="clip"][aria-label="De-ess"]',
  );

// Types `value` into a knob's readout.
async function setKnob(page: Page, label: string, value: string) {
  const device = deEssDevice(page);
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("De-ess is added from a clip's Audio menu with its defaults and turns down sibilance", async ({
  page,
}) => {
  await probeAnalysers(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  // Long enough to keep playing through every check.
  await addSound(page, 20);

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  // An audio clip is offered only audio effects, so its menu needs no
  // Audio heading.
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Dynamics" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^De-ess/ }).click();

  const device = deEssDevice(page);
  await expect(device).toHaveCount(1);
  await expect(device.getByRole("img", { name: "Audio effect" })).toBeVisible();
  await expect(
    device.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(0);
  for (const [label, text] of [
    ["Frequency", "6.00 kHz"],
    ["Threshold", "−20.0 dB"],
    ["Amount", "6.0 dB"],
  ]) {
    await expect(device.getByRole("slider", { name: label })).toHaveAttribute(
      "aria-valuetext",
      text,
    );
  }
  const listen = device.getByRole("group", { name: "Listen" });
  for (const option of ["Off", "On"]) {
    await expect(listen.getByRole("button", { name: option })).toHaveAttribute(
      "aria-pressed",
      String(option === "Off"),
    );
  }

  // At its defaults the 6 kHz tone sits at Threshold, so nothing changes:
  // about half the mix's power is sibilance.
  await playFromStart(page);
  let clean = { level: 0, sibilance: 0 };
  await expect
    .poll(
      async () => {
        clean = await settledReading(page);
        return clean.level;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0.01);
  expect(clean.sibilance).toBeGreaterThan(0.3);

  // 40 dB over Threshold, it takes the full 24 dB off the 6 kHz tone.
  await setKnob(page, "Threshold", "-60");
  await setKnob(page, "Amount", "24");
  await expect(device.getByRole("slider", { name: "Amount" })).toHaveAttribute(
    "aria-valuetext",
    "24.0 dB",
  );
  await expect
    .poll(async () => (await settledReading(page)).sibilance, {
      timeout: 15_000,
    })
    .toBeLessThan(clean.sibilance * 0.1);

  // Listen solos the detection band, so the 300 Hz tone drops out.
  await listen.getByRole("button", { name: "On" }).click();
  await expect
    .poll(async () => (await settledReading(page)).sibilance, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0.9);

  // Bypassing it brings the untouched mix back.
  await device.getByRole("button", { name: "Bypass De-ess" }).click();
  await expect
    .poll(
      async () => {
        const { sibilance } = await settledReading(page);
        return Math.abs(sibilance - clean.sibilance);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(0.1);
});

test("a video clip's add menu lists De-ess in its Audio group", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(
      '[data-source-track-drop-target="new-track"]',
      type,
      { dataTransfer },
    );
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });

  await page.locator(".source-span").click();
  await page
    .getByRole("button", { name: "Add device to this clip" })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("group", { name: "Video" }).getByRole("menuitem", {
      name: "Dynamics",
    }),
  ).toHaveCount(0);
  await menu
    .getByRole("group", { name: "Audio" })
    .getByRole("menuitem", { name: "Dynamics" })
    .press("ArrowRight");
  await page.getByRole("menuitem", { name: /^De-ess/ }).click();
  await expect(deEssDevice(page)).toHaveCount(1);
});

test("the export's offline render runs De-ess exactly as the chain does", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // Variables, so the type checker doesn't resolve the dev server paths.
    const offlinePath = "/src/audio-mix/offline.ts";
    const chainPath = "/src/audio-mix/chain.ts";
    const processorsPath = "/src/audio-mix/processors.ts";
    const { renderAudioMixOffline } = await import(offlinePath);
    const { AudioChain, BLOCK_FRAMES } = await import(chainPath);
    const { AUDIO_PROCESSORS } = await import(processorsPath);

    const sampleRate = 48_000;
    const length = sampleRate * 2;
    // A 300 Hz tone with a 6 kHz tone that swells in and out, as a 16-bit
    // WAV, so the reduction moves.
    const wav = new DataView(new ArrayBuffer(44 + length * 2));
    const ascii = (offset: number, text: string) => {
      for (let index = 0; index < text.length; index++) {
        wav.setUint8(offset + index, text.charCodeAt(index));
      }
    };
    ascii(0, "RIFF");
    wav.setUint32(4, wav.byteLength - 8, true);
    ascii(8, "WAVEfmt ");
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, sampleRate, true);
    wav.setUint32(28, sampleRate * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    ascii(36, "data");
    wav.setUint32(40, length * 2, true);
    for (let index = 0; index < length; index++) {
      const t = index / sampleRate;
      const swell = 0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * t);
      const sample =
        0.2 * Math.sin(2 * Math.PI * 300 * t) +
        0.3 * swell * Math.sin(2 * Math.PI * 6000 * t);
      wav.setInt16(44 + index * 2, Math.round(sample * 32767), true);
    }
    const url = URL.createObjectURL(new Blob([wav.buffer]));

    const stage = {
      id: "de-ess",
      effectName: "De-ess",
      enabled: true,
      numbers: { Frequency: 6000, Threshold: -30, Amount: 12 },
      switches: { Listen: "Off" },
    };
    const signature = { numerator: 4, denominator: 4 };
    const mix = {
      clips: [
        {
          id: "clip",
          mediaId: "ess",
          startSeconds: 0,
          durationSeconds: 2,
          sourceOffsetSeconds: 0,
          sourceWindowStartSeconds: 0,
          sourceWindowEndSeconds: 2,
          effects: [],
          amplitude: 1,
          hasGain: true,
          busId: "bus",
          stages: [stage],
        },
      ],
      buses: [{ id: "bus", stages: [] }],
      master: [],
      masterAmplitude: 1,
      fromSourceTracks: true,
      bpm: 120,
      signature,
    };
    const [exported] = await renderAudioMixOffline(
      mix,
      [{ id: "ess", previewUrl: url }],
      { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
    );

    // The same sound, decoded the same way, through a lone chain.
    const context = new OfflineAudioContext(1, 1, sampleRate);
    const decoded = await context.decodeAudioData(
      await (await fetch(url)).arrayBuffer(),
    );
    const input = decoded.getChannelData(0);
    const chain = new AudioChain(AUDIO_PROCESSORS, sampleRate, 1);
    chain.configure(
      { stages: [stage], inputGain: 1, delayFrames: 0 },
      { bpm: 120, signature },
    );
    const direct = new Float32Array(length);
    const block = [new Float32Array(BLOCK_FRAMES)];
    for (let start = 0; start < length; start += BLOCK_FRAMES) {
      const frames = Math.min(BLOCK_FRAMES, length - start);
      const source = new Float32Array(BLOCK_FRAMES);
      source.set(input.subarray(start, start + frames));
      chain.process([source], block, frames, start / sampleRate);
      direct.set(block[0].subarray(0, frames), start);
    }

    let difference = 0;
    let change = 0;
    for (let index = 0; index < length; index++) {
      difference = Math.max(
        difference,
        Math.abs(exported[index] - direct[index]),
      );
      change = Math.max(change, Math.abs(exported[index] - input[index]));
    }
    return { difference, change };
  });
  expect(result.difference).toBeLessThanOrEqual(1e-5);
  // And it does turn the 6 kHz swell down.
  expect(result.change).toBeGreaterThan(0.05);
});
