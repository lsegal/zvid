import { expect, test } from "@playwright/test";

// The preview runs audio effect chains in the chain worklet; export renders
// them offline in plain JS (see src/audio-mix/mix.ts). Both run the same
// DSP, so a mix played through the real worklet in an OfflineAudioContext
// must match the offline render to within floating-point noise.

test("the chain worklet plays a mix as the offline render does", async ({
  page,
}) => {
  await page.goto("/export-smoke.html");
  const result = await page.evaluate(async () => {
    // Variables keep TypeScript from resolving the dev server's paths.
    const paths = {
      url: "/src/audio-mix/chain-worklet-url.ts",
      node: "/src/audio-mix/chain-node.ts",
      mix: "/src/audio-mix/mix.ts",
      gain: "/src/fx/effects/gain/processor.ts",
    };
    const { CHAIN_WORKLET_URL } = await import(/* @vite-ignore */ paths.url);
    const { createChainNode } = await import(/* @vite-ignore */ paths.node);
    const { renderAudioMix } = await import(/* @vite-ignore */ paths.mix);
    const { gainStageAt } = await import(/* @vite-ignore */ paths.gain);

    const sampleRate = 48_000;
    const length = sampleRate;
    const toneSeconds = 2;
    const tone = new Float32Array(toneSeconds * sampleRate);
    for (let index = 0; index < tone.length; index++) {
      tone[index] = 0.3 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    }
    const clipStart = 0.25;
    const clip = {
      id: "tone",
      mediaId: "tone",
      startSeconds: clipStart,
      durationSeconds: 0.5,
      sourceOffsetSeconds: -clipStart,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: toneSeconds,
      effects: [],
      amplitude: 0.5,
      hasGain: true,
      busId: "bus",
      stages: [gainStageAt(0.5, "clip-gain")],
    };
    const mix = {
      clips: [clip],
      buses: [{ id: "bus", stages: [gainStageAt(0.8, "bus-gain")] }],
      master: [gainStageAt(1.5, "master-gain")],
      masterAmplitude: 1.5,
      fromSourceTracks: true,
      bpm: 120,
      signature: { numerator: 4, denominator: 4 },
    };
    const [offline] = renderAudioMix(
      mix,
      new Map([["tone", { sampleRate, channels: [tone] }]]),
      { sampleRate, numberOfChannels: 1, startSeconds: 0, length },
    );

    const context = new OfflineAudioContext(2, length, sampleRate);
    await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
    const tempo = { bpm: 120, signature: mix.signature };
    const transport = { contextTime: 0, timelineSeconds: 0, rate: 1 };
    const node = (stages: unknown[]) =>
      createChainNode(context, {
        settings: { stages, inputGain: 1, delayFrames: 0 },
        tempo,
        transport,
      });
    const clipChain = node(clip.stages);
    const bus = node(mix.buses[0].stages);
    const master = node(mix.master);
    // The clip's media plays from its source window as its element would.
    const media = context.createBuffer(1, tone.length, sampleRate);
    media.copyToChannel(tone, 0);
    const source = context.createBufferSource();
    source.buffer = media;
    source.connect(clipChain);
    clipChain.connect(bus);
    bus.connect(master);
    master.connect(context.destination);
    source.start(clipStart, 0, clip.durationSeconds);
    const rendered = (await context.startRendering()).getChannelData(0);

    let difference = 0;
    let peak = 0;
    for (let index = 0; index < length; index++) {
      difference = Math.max(
        difference,
        Math.abs(rendered[index] - offline[index]),
      );
      peak = Math.max(peak, Math.abs(offline[index]));
    }
    return { difference, peak };
  });
  // 0.3 × 0.5 × 0.8 × 1.5, below the limiter's knee.
  expect(result.peak).toBeGreaterThan(0.17);
  expect(result.difference).toBeLessThan(1e-5);
});
