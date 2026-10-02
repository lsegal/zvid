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
  type ChainTransport,
} from "./chain-node.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";

// The AudioWorkletGlobalScope's own globals.
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new (options: {
    processorOptions?: { channels?: number };
  }) => AudioWorkletProcessor,
): void;

export class ChainWorkletProcessor extends AudioWorkletProcessor {
  private readonly chain: AudioChain;
  private readonly silence: Float32Array;
  private readonly input: Float32Array[];
  private transport: ChainTransport = {
    contextTime: 0,
    timelineSeconds: 0,
    rate: 0,
  };

  constructor(options: { processorOptions?: { channels?: number } }) {
    super();
    const channels = options.processorOptions?.channels ?? 2;
    this.chain = new AudioChain(AUDIO_PROCESSORS, sampleRate, channels);
    this.silence = new Float32Array(this.chain.maxFrames);
    this.input = Array.from({ length: channels }, () => this.silence);
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
    return true;
  }
}

registerProcessor(CHAIN_PROCESSOR_NAME, ChainWorkletProcessor);
