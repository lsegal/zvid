import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DecodedAudio } from "./audio-mix/mix.ts";
import type { SynthClip } from "./audio-mix/synth.ts";
import { DEFAULT_SYNTH_PARAMS } from "./midi-clip.ts";
import type { SynthWaveformRequest } from "./synth-waveform.worker.ts";
import {
  SYNTH_WAVEFORM_SAMPLE_RATE,
  SynthWaveformLoader,
} from "./synth-waveform-loader.ts";
import { peaksOfChannels } from "./waveform-peaks.ts";

const SYNTH: SynthClip = {
  notes: [{ pitch: 60, start: 0, length: 1, velocity: 100 }],
  instrument: { kind: "synth", params: DEFAULT_SYNTH_PARAMS },
  durationSeconds: 1,
};

// A second of a half-level square at `sampleRate`.
function squareAudio(sampleRate: number): DecodedAudio {
  const channel = new Float32Array(sampleRate).map((_, index) =>
    index % 2 ? 0.5 : -0.5,
  );
  return { sampleRate, channels: [channel] };
}

// Answers like synth-waveform.worker.ts, a task later, or fails to start
// once asked.
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  private readonly fails: boolean;
  constructor(fails = false) {
    this.fails = fails;
  }
  postMessage({ id, sampleRate, channels }: SynthWaveformRequest) {
    setTimeout(() => {
      if (this.fails) {
        this.onerror?.({ preventDefault() {} });
        return;
      }
      this.onmessage?.({
        data: { id, result: peaksOfChannels(sampleRate, channels) },
      });
    });
  }
  terminate() {}
}

// A loader whose renders are recorded, with at most `concurrent` of them
// seen running at once.
function loader(createWorker = () => new FakeWorker() as unknown as Worker) {
  const renders: { synth: SynthClip; bpm: number; sampleRate: number }[] = [];
  let running = 0;
  const seen = { concurrent: 0 };
  const instance = new SynthWaveformLoader(async (synth, bpm, sampleRate) => {
    renders.push({ synth, bpm, sampleRate });
    running += 1;
    seen.concurrent = Math.max(seen.concurrent, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running -= 1;
    return squareAudio(sampleRate);
  }, createWorker);
  return { instance, renders, seen };
}

describe("SynthWaveformLoader", () => {
  it("renders a performance once into peaks, at the waveform rate", async () => {
    const { instance, renders } = loader();
    const first = instance.request("synth:a:1", SYNTH, 120);
    const second = instance.request("synth:a:1", SYNTH, 120);
    const result = await first.peaks;
    assert.equal(await second.peaks, result);
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.ok(Math.abs(result.peaks.durationSeconds - 1) < 1e-6);
      assert.equal(Math.max(...result.peaks.max), 0.5);
      assert.equal(Math.min(...result.peaks.min), -0.5);
    }
    assert.deepEqual(renders, [
      { synth: SYNTH, bpm: 120, sampleRate: SYNTH_WAVEFORM_SAMPLE_RATE },
    ]);

    // Released peaks are kept for the same performance.
    first.release();
    second.release();
    await instance.request("synth:a:1", SYNTH, 120).peaks;
    assert.equal(renders.length, 1);
  });

  it("renders a changed performance again", async () => {
    const { instance, renders } = loader();
    await instance.request("synth:a:1", SYNTH, 120).peaks;
    await instance.request("synth:a:2", SYNTH, 120).peaks;
    assert.equal(renders.length, 2);
  });

  it("renders one clip at a time, dropping renders nothing holds", async () => {
    const { instance, renders, seen } = loader();
    const first = instance.request("synth:a:1", SYNTH, 120);
    // An edit replaces the performance before it renders.
    const stale = instance.request("synth:a:2", SYNTH, 120);
    stale.release();
    const latest = instance.request("synth:a:3", SYNTH, 120);
    const other = instance.request("synth:b:1", SYNTH, 120);
    await Promise.all([first.peaks, latest.peaks, other.peaks]);
    assert.equal(seen.concurrent, 1);
    assert.equal(renders.length, 3);
    assert.equal((await stale.peaks).status, "no-audio");

    // The dropped render is not kept as missing.
    const again = await instance.request("synth:a:2", SYNTH, 120).peaks;
    assert.equal(again.status, "ready");
  });

  it("draws no waveform and renders nothing without workers", async () => {
    const { instance, renders } = loader(() => {
      throw new Error("Workers are disabled");
    });
    const result = await instance.request("synth:a:1", SYNTH, 120).peaks;
    assert.deepEqual(result, { status: "no-audio" });
    assert.equal(renders.length, 0);
  });

  it("draws no waveform when the worker fails to start", async () => {
    const { instance } = loader(
      () => new FakeWorker(true) as unknown as Worker,
    );
    const result = await instance.request("synth:a:1", SYNTH, 120).peaks;
    assert.deepEqual(result, { status: "no-audio" });
  });
});
