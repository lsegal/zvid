// The main thread's side of the chain worklet (see chain-worklet.ts): the
// messages a chain node takes and the node itself. Each AudioWorkletNode
// runs one AudioChain: a clip's, a bus's or the master's.
import type { AudioChainSettings } from "./chain.ts";
import type { AudioTempo } from "./processor.ts";

export const CHAIN_PROCESSOR_NAME = "zvid-audio-chain";

// Where the timeline is: at context time `contextTime` the playhead was at
// `timelineSeconds`, moving `rate` timeline seconds per second (0 while
// paused). The worklet derives each block's timeline time from it.
export type ChainTransport = {
  contextTime: number;
  timelineSeconds: number;
  rate: number;
};

export type ChainMessage =
  | { type: "configure"; settings: AudioChainSettings; tempo: AudioTempo }
  | ({ type: "transport" } & ChainTransport)
  // Drops the chain's state, as after a seek, so no stale tail plays.
  | { type: "reset" }
  // The stages whose Transient levels the main thread wants reported.
  | { type: "watch"; ids: readonly string[] };

// What a chain node posts back: each watched Transient stage's level (see
// StageModulator), about TRANSIENT_REPORT_RATE times a second.
export type ChainReport = {
  type: "transients";
  levels: [id: string, level: number][];
};

// How often a chain node reports its watched Transient levels: about the
// display's frame rate, for the Modulation section's graph.
export const TRANSIENT_REPORT_RATE = 60;

// What a chain node starts with, so it never plays a block unconfigured.
export type ChainNodeOptions = {
  channels?: number;
  settings: AudioChainSettings;
  tempo: AudioTempo;
  transport?: ChainTransport;
  watch?: readonly string[];
};

export function createChainNode(
  context: BaseAudioContext,
  { channels = 2, ...initial }: ChainNodeOptions,
) {
  return new AudioWorkletNode(context, CHAIN_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
    // Mono media is upmixed to every channel, as the offline render spreads
    // it.
    channelCount: channels,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    processorOptions: { channels, ...initial },
  });
}

export function postChainMessage(
  node: AudioWorkletNode,
  message: ChainMessage,
) {
  node.port.postMessage(message);
}
