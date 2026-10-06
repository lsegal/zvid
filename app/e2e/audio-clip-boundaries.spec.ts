import { expect, test } from "@playwright/test";

// Back-to-back clips played from decoded buffers, as WebKit plays short
// audio-only clips (see preview-buffer-voice.ts), meet with no gap of
// silence and no overlap, however late the main thread syncs the mixer.
// Each voice used to start at the first sync after its clip started, so on
// a slow main thread, as on an iPhone, every clip boundary dropped out for
// as long as that sync was late (#1115).
test("back-to-back decoded clips meet without gaps on a slow main thread", async ({
  page,
}) => {
  await page.goto("/export-smoke.html");
  const result = await page.evaluate(async () => {
    // Variables keep TypeScript from resolving the dev server's paths.
    const paths = {
      mixer: "/src/audio-mix/preview-mixer.ts",
      gain: "/src/fx/effects/gain/processor.ts",
    };
    const { PreviewAudioMixer } = await import(/* @vite-ignore */ paths.mixer);
    const { gainStageAt } = await import(/* @vite-ignore */ paths.gain);

    // A continuous 440 Hz tone as a 16-bit mono WAV.
    const sampleRate = 48_000;
    const mediaSeconds = 8;
    const frames = mediaSeconds * sampleRate;
    const wav = new DataView(new ArrayBuffer(44 + frames * 2));
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
    wav.setUint32(40, frames * 2, true);
    for (let index = 0; index < frames; index++) {
      const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
      wav.setInt16(44 + index * 2, Math.round(sample * 16_000), true);
    }
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));

    // Six half-second clips, each playing the tone on from where the last
    // left off.
    const clipSeconds = 0.5;
    const clips = Array.from({ length: 6 }, (_, index) => ({
      id: `clip-${index}`,
      mediaId: "tone",
      startSeconds: index * clipSeconds,
      durationSeconds: clipSeconds,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: mediaSeconds,
      mediaDurationSeconds: mediaSeconds,
      effects: [],
      amplitude: 1,
      hasGain: true,
      busId: "bus",
      stages: [gainStageAt(1, `gain-${index}`)],
    }));
    const mixer = new PreviewAudioMixer({ preferDecodedAudio: true });
    mixer.update(
      {
        clips,
        buses: [{ id: "bus", stages: [] }],
        master: [],
        masterAmplitude: 1,
        fromSourceTracks: true,
        bpm: 120,
        signature: { numerator: 4, denominator: 4 },
      },
      [{ id: "tone", kind: "audio", name: "tone.wav", previewUrl: url }],
    );
    const playback = (playheadSeconds: number, isPlaying: boolean) => ({
      playheadSeconds,
      isPlaying,
      isScrubbing: false,
      isAudibleScrubbing: false,
      isContinuousScrubbing: false,
    });
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    // Parked before the start, the voices decode their clips.
    mixer.sync(playback(-0.5, false));
    const { context, analyser } = (
      mixer as unknown as {
        graph: { context: AudioContext; analyser: AnalyserNode };
      }
    ).graph;

    // Hears the mix: each run of silence in the tone longer than 2 ms, and
    // the loudest sample, which two clips overlapping would raise.
    const tap = `registerProcessor("boundary-tap", class extends AudioWorkletProcessor {
      quiet = 0; heard = false; gaps = []; peak = 0;
      constructor() {
        super();
        this.port.onmessage = () =>
          this.port.postMessage({ gaps: this.gaps, peak: this.peak });
      }
      process([input]) {
        for (const sample of input[0] ?? []) {
          this.peak = Math.max(this.peak, Math.abs(sample));
          if (Math.abs(sample) < 0.02) {
            this.quiet++;
            continue;
          }
          if (this.heard && this.quiet > sampleRate * 0.002) {
            this.gaps.push((this.quiet / sampleRate) * 1000);
          }
          this.quiet = 0;
          this.heard = true;
        }
        return true;
      }
    });`;
    await context.audioWorklet.addModule(
      URL.createObjectURL(new Blob([tap], { type: "text/javascript" })),
    );
    const node = new AudioWorkletNode(context, "boundary-tap");
    analyser.connect(node);
    await context.resume();
    for (let sync = 0; sync < 40; sync++) {
      mixer.sync(playback(-0.5, false));
      await wait(25);
    }

    // Plays to just before the last clip ends, on the wall clock as the
    // transport does, syncing only every 60 ms.
    const startedAt = performance.now();
    const endSeconds = clips.length * clipSeconds - 0.1;
    for (;;) {
      const seconds = (performance.now() - startedAt) / 1000;
      if (seconds >= endSeconds) {
        break;
      }
      mixer.sync(playback(seconds, true));
      await wait(60);
    }
    mixer.pause();
    const heard = await new Promise<{ gaps: number[]; peak: number }>(
      (resolve) => {
        node.port.onmessage = (event) => resolve(event.data);
        node.port.postMessage("read");
      },
    );
    mixer.dispose();
    return heard;
  });
  // The tone plays at about 0.49 throughout.
  expect(result.peak).toBeGreaterThan(0.4);
  expect(result.peak).toBeLessThan(0.6);
  expect(result.gaps).toEqual([]);
});
