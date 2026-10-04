// The chain worklet: the preview's host for audio effect chains. It bundles
// every registered processor (see fx/effects/processors.generated.ts) and
// runs one AudioChain per node, the same chain export renders through (see
// mix.ts), so the preview hears the same DSP. Load it with
// `audioWorklet.addModule` (see chain-worklet-url.ts); chain-node.ts makes
// its nodes.
import { AudioChain } from "./chain.ts";
import {
  CHAIN_PROCESSOR_NAME,
  type ChainMessage,
  type ChainNodeOptions,
  type ChainReport,
  type ChainTransport,
  TRANSIENT_REPORT_RATE,
} from "./chain-node.ts";
import type { AudioProcessorRegistry } from "./processor.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";

// The AudioWorkletGlobalScope's own globals.
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
type ProcessorOptions = { processorOptions?: ChainNodeOptions };
declare function registerProcessor(
  name: string,
  processor: new (options: ProcessorOptions) => AudioWorkletProcessor,
): void;

// The worklet processor class that runs chains of the processors in
// `registry`.
export function chainWorkletProcessor(registry: AudioProcessorRegistry) {
  return class ChainWorkletProcessor extends AudioWorkletProcessor {
    private readonly chain: AudioChain;
    private readonly silence: Float32Array;
    private readonly input: Float32Array[];
    private transport: ChainTransport = {
      contextTime: 0,
      timelineSeconds: 0,
      rate: 0,
    };
    private watched = new Set<string>();
    // Frames played since the last Transient report.
    private unreported = 0;

    constructor({ processorOptions }: ProcessorOptions) {
      super();
      const channels = processorOptions?.channels ?? 2;
      this.chain = new AudioChain(registry, sampleRate, channels);
      this.silence = new Float32Array(this.chain.maxFrames);
      this.input = Array.from({ length: channels }, () => this.silence);
      if (processorOptions) {
        this.chain.configure(processorOptions.settings, processorOptions.tempo);
        this.transport = processorOptions.transport ?? this.transport;
        this.watched = new Set(processorOptions.watch);
      }
      this.port.onmessage = (event: MessageEvent<ChainMessage>) => {
        this.receive(event.data);
      };
    }

    receive(message: ChainMessage) {
      switch (message.type) {
        case "configure":
          this.chain.configure(message.settings, message.tempo);
          break;
        case "transport":
          this.transport = {
            contextTime: message.contextTime,
            timelineSeconds: message.timelineSeconds,
            rate: message.rate,
          };
          break;
        case "reset":
          this.chain.reset();
          break;
        case "watch":
          this.watched = new Set(message.ids);
          break;
      }
    }

    // Posts the watched stages' Transient levels once enough frames have
    // played since the last report.
    report(frames: number) {
      if (!this.watched.size) {
        return;
      }
      this.unreported += frames;
      const interval = sampleRate / TRANSIENT_REPORT_RATE;
      if (this.unreported < interval) {
        return;
      }
      this.unreported %= interval;
      const levels: ChainReport["levels"] = [];
      this.chain.forEachTransient((id, level) => {
        if (this.watched.has(id)) {
          levels.push([id, level]);
        }
      });
      if (levels.length) {
        const report: ChainReport = { type: "transients", levels };
        this.port.postMessage(report);
      }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]) {
      const [input = []] = inputs;
      const [output = []] = outputs;
      const frames = output[0]?.length ?? 0;
      if (!frames) {
        return true;
      }
      // An unconnected input has no channels: silence.
      for (let channel = 0; channel < this.input.length; channel++) {
        this.input[channel] = input[channel] ?? input[0] ?? this.silence;
      }
      const { contextTime, timelineSeconds, rate } = this.transport;
      this.chain.process(
        this.input,
        output,
        frames,
        timelineSeconds + (currentTime - contextTime) * rate,
      );
      this.report(frames);
      return true;
    }
  };
}

registerProcessor(
  CHAIN_PROCESSOR_NAME,
  chainWorkletProcessor(AUDIO_PROCESSORS),
);
