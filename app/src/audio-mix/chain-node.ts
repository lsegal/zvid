// The main thread's side of the chain worklet (see chain-worklet.ts): the
// messages a chain node takes and the node itself. Each AudioWorkletNode
// runs one AudioChain: a clip's, a bus's or the master's.
import type { AudioChainSettings } from "./chain.ts";
import type { AudioTempo } from "./processor.ts";
import { loopedSeconds, type PlaybackLoop } from "./voice-window.ts";

export const CHAIN_PROCESSOR_NAME = "zvid-audio-chain";

// Where the timeline is: at context time `contextTime` the playhead was at
// `timelineSeconds`, moving `rate` timeline seconds per second (0 while
// paused). The worklet derives each block's timeline time from it.
export type ChainTransport = {
  contextTime: number;
  timelineSeconds: number;
  rate: number;
};

// A playhead this far from where the chains expect it is a seek, which
// resets them so no stale tail plays; a smaller gap only re-anchors their
// timeline time.
const SEEK_SECONDS = 0.25;
const TRANSPORT_DRIFT_SECONDS = 0.02;

// The timeline time `transport` puts at context time `contextTime`.
export function timelineAt(transport: ChainTransport, contextTime: number) {
  return (
    transport.timelineSeconds +
    (contextTime - transport.contextTime) * transport.rate
  );
}

// The transport to tell the chains, at context time `contextTime`, of a
// playhead at `now`, `playing` or not, when `previous` no longer says
// where it is, and whether that is a seek that resets them; null while it
// still does. Playback wrapping at `loop`'s out marker is no seek: the
// chains play on into the next pass, as they play into the loop the first
// time, with their tails.
export function nextTransport(
  previous: ChainTransport | null,
  contextTime: number,
  now: number,
  playing: boolean,
  loop?: PlaybackLoop,
): { transport: ChainTransport; reset: boolean } | null {
  const rate = playing ? 1 : 0;
  const expected = previous ? timelineAt(previous, contextTime) : now;
  const gap = Math.abs(expected - now);
  if (previous && previous.rate === rate && gap <= TRANSPORT_DRIFT_SECONDS) {
    return null;
  }
  const wrapGap = Math.abs(loopedSeconds(now, expected, loop) - now);
  return {
    transport: { contextTime, timelineSeconds: now, rate },
    reset: Boolean(previous) && Math.min(gap, wrapGap) > SEEK_SECONDS,
  };
}

export type ChainMessage =
  | { type: "configure"; settings: AudioChainSettings; tempo: AudioTempo }
  | ({ type: "transport" } & ChainTransport)
  // Drops the chain's state, as after a seek, so no stale tail plays.
  | { type: "reset" }
  // The stages whose Transient levels the main thread wants reported.
  | { type: "watch"; ids: readonly string[] };

// What a chain node posts back: each watched Transient stage's level and
// the seed of its hit (see StageModulator), about TRANSIENT_REPORT_RATE
// times a second.
export type ChainReport = {
  type: "transients";
  levels: [id: string, level: number, hit?: number][];
};

// How often a chain node reports its watched Transient levels: about the
// display's frame rate, for the Modulation section's graph and knobs.
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
