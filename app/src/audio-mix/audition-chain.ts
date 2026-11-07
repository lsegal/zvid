// The effect chains MIDI auditions play through (see midi-audition.ts): one
// per source track, the same DSP the mix runs (see chain.ts), holding the
// clip's stack, its track's and the Global one, then the mix's limiter, so a
// key sounds as the track does in playback. A track's chain outlives its notes,
// so they share its tails and its LFOs carry on from one to the next.
//
// A chain's transport always moves at the audio clock's rate. It starts from
// the playhead and runs on from there whether or not the session is playing,
// so LFOs keep sweeping under a paused key. It lives only on the audition's own
// context: the mix's chains, and so playback and export, stay on session time.
import { isGainEffectName } from "../fx/effects/gain/gain.ts";
import {
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { isAudioEffectName } from "../fx-registry.ts";
import { type AudioChainSettings, chainTailSeconds } from "./chain.ts";
import {
  type ChainTransport,
  createChainNode,
  postChainMessage,
} from "./chain-node.ts";
import { LIMITER_HEADROOM, limiterCurve } from "./mix.ts";
import type { AudioTempo } from "./processor.ts";
import { AUDIO_PROCESSORS } from "./processors.ts";
import {
  type AudioStageEffect,
  audioStageOf,
  steadyGainAmplitude,
} from "./stages.ts";

// What a note auditioned on a source track plays through.
export type AuditionStack = {
  trackId: string;
  spanId: string;
  settings: AudioChainSettings;
  tempo: AudioTempo;
  playheadSeconds: number;
};

/**
 * The chain a note on the clip `spanId` of the track `trackId` plays through:
 * the clip's audio effects, its track's, then Global's, in the mix's order. As
 * in the mix (see resolve.ts) a track without an enabled Gain is silent, and
 * one with its FX switched off bypasses all but Global.
 */
export function auditionChainSettings(
  effects: readonly AudioStageEffect[],
  trackId: string,
  spanId: string,
  fxEnabled: boolean,
): AudioChainSettings {
  const stackOf = (stackId: string) =>
    effects.filter(
      (effect) =>
        effect.trackId === stackId && isAudioEffectName(effect.effectName),
    );
  const stagesOf = (stackId: string, enabled = true) =>
    stackOf(stackId).map((effect, index) =>
      audioStageOf(effect, `${stackId}:${index}`, enabled),
    );
  const clipStackId = sourceClipEffectTrackId(spanId);
  const trackStackId = sourceTrackEffectTrackId(trackId);
  const hasGain = [...stackOf(clipStackId), ...stackOf(trackStackId)].some(
    (effect) => effect.enabled !== false && isGainEffectName(effect.effectName),
  );
  return {
    stages: [
      ...stagesOf(clipStackId, fxEnabled),
      ...stagesOf(trackStackId, fxEnabled),
      ...stagesOf(GLOBAL_EFFECT_TRACK_ID),
    ],
    inputGain: hasGain || !fxEnabled ? 1 : 0,
    delayFrames: 0,
  };
}

/** How long a chain with `stack`'s settings sounds on after its last voice. */
export function auditionTailSeconds({ settings, tempo }: AuditionStack) {
  return chainTailSeconds(AUDIO_PROCESSORS, settings.stages, tempo);
}

type TrackChain = {
  // What voices connect to, from before the chain itself can be made.
  input: GainNode;
  node: AudioWorkletNode | null;
  stack: AuditionStack;
  posted: string;
  transport: ChainTransport;
};

type WorkletState = "idle" | "loading" | "ready" | "failed";

export class AuditionChains {
  private readonly wake: (context: AudioContext) => void;
  private context: AudioContext | null = null;
  private worklet: WorkletState = "idle";
  private output: AudioNode | null = null;
  private readonly chains = new Map<string, TrackChain>();

  // `wake` resumes a context held suspended while the worklet loaded, if
  // anything is still waiting on it.
  constructor(wake: (context: AudioContext) => void) {
    this.wake = wake;
  }

  /**
   * The node a voice of `stack` connects to in `context`. A playhead that hasn't
   * moved since its chain was last placed is paused there, and the chain's LFOs
   * carry on. One that has is playing or was moved, and the chain follows it.
   */
  input(context: AudioContext, stack: AuditionStack): AudioNode {
    if (context !== this.context) {
      this.context = context;
      this.worklet = "idle";
      this.output = null;
      this.chains.clear();
    }
    const transport: ChainTransport = {
      contextTime: context.currentTime,
      timelineSeconds: stack.playheadSeconds,
      rate: 1,
    };
    let chain = this.chains.get(stack.trackId);
    if (!chain) {
      chain = {
        input: context.createGain(),
        node: null,
        stack,
        posted: "",
        transport,
      };
      this.chains.set(stack.trackId, chain);
    } else if (chain.stack.playheadSeconds !== stack.playheadSeconds) {
      chain.transport = transport;
      if (chain.node) {
        postChainMessage(chain.node, { type: "transport", ...transport });
      }
    }
    this.configure(chain, stack);
    this.connect(context, chain);
    return chain.input;
  }

  /** Has the open chains follow an edit: `resolve` gives each clip's stack now. */
  update(resolve: (spanId: string) => AuditionStack | undefined) {
    for (const [trackId, chain] of this.chains) {
      const stack = resolve(chain.stack.spanId);
      if (stack) {
        this.configure(chain, {
          ...stack,
          playheadSeconds: chain.stack.playheadSeconds,
        });
      } else {
        chain.node?.disconnect();
        chain.input.disconnect();
        this.chains.delete(trackId);
      }
    }
  }

  private configure(chain: TrackChain, stack: AuditionStack) {
    chain.stack = stack;
    const posted = JSON.stringify([stack.settings, stack.tempo]);
    if (chain.node && chain.posted !== posted) {
      postChainMessage(chain.node, {
        type: "configure",
        settings: stack.settings,
        tempo: stack.tempo,
      });
    }
    chain.posted = posted;
    if (this.worklet === "failed") {
      chain.input.gain.value = this.gainAlone(stack);
    }
  }

  private connect(context: AudioContext, chain: TrackChain) {
    if (this.worklet === "idle") {
      void this.load(context);
    }
    if (this.worklet === "loading") {
      // Nothing plays until there are chains to play through, so a first note
      // keeps its attack.
      void context.suspend().catch(() => {});
    }
    if (this.worklet === "ready" && !chain.node) {
      chain.node = createChainNode(context, {
        settings: chain.stack.settings,
        tempo: chain.stack.tempo,
        transport: chain.transport,
      });
      chain.input.connect(chain.node).connect(this.limiter(context));
    }
    if (this.worklet === "failed") {
      chain.input.gain.value = this.gainAlone(chain.stack);
      chain.input.connect(context.destination);
    }
  }

  private async load(context: AudioContext) {
    this.worklet = "loading";
    try {
      // Imported here because only Vite can resolve it (see chain-worklet-url.ts).
      const { CHAIN_WORKLET_URL } = await import("./chain-worklet-url.ts");
      await context.audioWorklet.addModule(CHAIN_WORKLET_URL);
      this.worklet = "ready";
    } catch (error) {
      console.warn("Auditions play without their effects.", error);
      this.worklet = "failed";
    }
    if (context !== this.context) {
      return;
    }
    for (const chain of this.chains.values()) {
      this.connect(context, chain);
    }
    this.wake(context);
  }

  // As the preview plays without its worklet: its Gains alone.
  private gainAlone({ settings }: AuditionStack) {
    return (
      settings.inputGain *
      steadyGainAmplitude(AUDIO_PROCESSORS, settings.stages)
    );
  }

  private limiter(context: AudioContext) {
    if (!this.output) {
      const headroom = context.createGain();
      headroom.gain.value = 1 / LIMITER_HEADROOM;
      const limiter = context.createWaveShaper();
      limiter.curve = limiterCurve();
      headroom.connect(limiter).connect(context.destination);
      this.output = headroom;
    }
    return this.output;
  }
}
