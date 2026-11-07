// The effect chains MIDI auditions play through (see midi-audition.ts): one
// per source track, the same DSP the mix runs (see chain.ts), holding the
// clip's stack, its track's and the Global one, then the mix's limiter, so a
// key sounds as the track does in playback. Where the mix plays the track through
// a layer clip, it holds that clip's and its layer's stacks too. Where it plays
// the track through several at once, a note sounds through a chain for each,
// summed into a chain for each layer, then one for Global, as in the mix. A
// track's chains outlive its notes, so they share its tails and its LFOs carry on
// from one to the next.
//
// A chain's transport always moves at the audio clock's rate. It starts from
// the playhead and runs on from there whether or not the session is playing,
// so LFOs keep sweeping under a paused key. It lives only on the audition's own
// context: the mix's chains, and so playback and export, stay on session time.
import { isGainEffectName } from "../fx/effects/gain/gain.ts";
import {
  clipEffectTrackId,
  GLOBAL_EFFECT_TRACK_ID,
  sourceClipEffectTrackId,
  sourceTrackEffectTrackId,
} from "../fx/stack/clip-stacks.ts";
import { isAudioEffectName } from "../fx-registry.ts";
import {
  type AudioChainSettings,
  chainLatencyFrames,
  chainTailSeconds,
} from "./chain.ts";
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
  withLfoTimeOffset,
} from "./stages.ts";

// A chain a note plays through: `settings` runs on the note itself, or where
// paths join, on the sum of `inputs`, which the note goes into instead.
export type AuditionChainGraph = {
  settings: AudioChainSettings;
  inputs?: readonly (AuditionChainGraph & { id: string })[];
};

// What a note auditioned on a source track plays through.
export type AuditionStack = AuditionChainGraph & {
  trackId: string;
  // The clip the note is on, which a note played into the track has none of.
  spanId?: string;
  tempo: AudioTempo;
  playheadSeconds: number;
};

// The layer clip the mix plays a source track through.
export type AuditionLayerClip = {
  clipId: string;
  laneId: string;
  laneFxEnabled: boolean;
  // Its source track second minus its song second, which the LFOs on the source
  // stacks it inherits run on.
  timeOffsetSeconds: number;
};

function stackReader(effects: readonly AudioStageEffect[]) {
  const stackOf = (stackId: string) =>
    effects.filter(
      (effect) =>
        effect.trackId === stackId && isAudioEffectName(effect.effectName),
    );
  const stagesOf = (stackId: string, enabled = true) =>
    stackOf(stackId).map((effect, index) =>
      audioStageOf(effect, `${stackId}:${index}`, enabled),
    );
  const gainIn = (stackIds: readonly string[]) =>
    stackIds
      .flatMap(stackOf)
      .some(
        (effect) =>
          effect.enabled !== false && isGainEffectName(effect.effectName),
      );
  return { stagesOf, gainIn };
}

// A layer clip's chain short of its layer's stack: the source stacks it inherits
// and its own, silent on a layer with its FX off or with no Gain on any of those.
function layerClipSettings(
  { stagesOf, gainIn }: ReturnType<typeof stackReader>,
  trackId: string,
  spanId: string | undefined,
  { clipId, laneId, laneFxEnabled, timeOffsetSeconds }: AuditionLayerClip,
): AudioChainSettings {
  const sourceStackIds = [
    sourceTrackEffectTrackId(trackId),
    ...(spanId === undefined ? [] : [sourceClipEffectTrackId(spanId)]),
  ];
  const clipStackId = clipEffectTrackId(clipId);
  return {
    stages: [
      ...sourceStackIds.flatMap((stackId) =>
        stagesOf(stackId, laneFxEnabled).map((stage) =>
          withLfoTimeOffset(stage, timeOffsetSeconds),
        ),
      ),
      ...stagesOf(clipStackId, laneFxEnabled),
    ],
    inputGain:
      laneFxEnabled && gainIn([...sourceStackIds, clipStackId, laneId]) ? 1 : 0,
    delayFrames: 0,
  };
}

/**
 * The chain a note on the clip `spanId` of the track `trackId`, or on the track
 * itself without one, plays through: the clip's audio effects, if any, its
 * track's, then Global's, in the mix's order. As
 * in the mix (see resolve.ts) a track without an enabled Gain is silent, and
 * one with its FX switched off bypasses all but Global.
 *
 * Through `layerClip`, the mix's order is the track's stack, the clip's, the
 * layer clip's, its layer's, then Global's. There a layer with its FX switched
 * off silences the note, as it does the clip in the mix.
 */
export function auditionChainSettings(
  effects: readonly AudioStageEffect[],
  trackId: string,
  spanId: string | undefined,
  fxEnabled: boolean,
  layerClip?: AuditionLayerClip,
): AudioChainSettings {
  const reader = stackReader(effects);
  const { stagesOf, gainIn } = reader;
  if (layerClip) {
    const { stages, ...rest } = layerClipSettings(
      reader,
      trackId,
      spanId,
      layerClip,
    );
    return {
      ...rest,
      stages: [
        ...stages,
        ...stagesOf(layerClip.laneId, layerClip.laneFxEnabled),
        ...stagesOf(GLOBAL_EFFECT_TRACK_ID),
      ],
    };
  }
  const clipStackIds =
    spanId === undefined ? [] : [sourceClipEffectTrackId(spanId)];
  const trackStackId = sourceTrackEffectTrackId(trackId);
  const hasGain = gainIn([...clipStackIds, trackStackId]);
  return {
    stages: [
      ...clipStackIds.flatMap((stackId) => stagesOf(stackId, fxEnabled)),
      ...stagesOf(trackStackId, fxEnabled),
      ...stagesOf(GLOBAL_EFFECT_TRACK_ID),
    ],
    inputGain: hasGain || !fxEnabled ? 1 : 0,
    delayFrames: 0,
  };
}

/**
 * What a note plays through with `layerClips` playing it: a lone chain, as
 * auditionChainSettings gives it, or the mix's graph where there are several.
 */
export function auditionChainGraph(
  effects: readonly AudioStageEffect[],
  trackId: string,
  spanId: string | undefined,
  fxEnabled: boolean,
  layerClips: readonly AuditionLayerClip[],
): AuditionChainGraph {
  if (layerClips.length < 2) {
    return {
      settings: auditionChainSettings(
        effects,
        trackId,
        spanId,
        fxEnabled,
        layerClips[0],
      ),
    };
  }
  const reader = stackReader(effects);
  const chainOf = (stages: AudioChainSettings["stages"]) => ({
    stages,
    inputGain: 1,
    delayFrames: 0,
  });
  return {
    settings: chainOf(reader.stagesOf(GLOBAL_EFFECT_TRACK_ID)),
    inputs: [...new Set(layerClips.map(({ laneId }) => laneId))].map(
      (laneId) => {
        const onLane = layerClips.filter((clip) => clip.laneId === laneId);
        return {
          id: laneId,
          settings: chainOf(reader.stagesOf(laneId, onLane[0].laneFxEnabled)),
          inputs: onLane.map((clip) => ({
            id: clip.clipId,
            settings: layerClipSettings(reader, trackId, spanId, clip),
          })),
        };
      },
    ),
  };
}

/** How long a chain with `stack`'s settings sounds on after its last voice. */
export function auditionTailSeconds(stack: AuditionStack) {
  const tailOf = ({ settings, inputs = [] }: AuditionChainGraph): number =>
    chainTailSeconds(AUDIO_PROCESSORS, settings.stages, stack.tempo) +
    Math.max(0, ...inputs.map(tailOf));
  return tailOf(stack);
}

// One chain of `graph`: `key` is its path from the root, and `delayFrames` lines
// up what comes through it with the slowest path, as the mix does.
type GraphChain = {
  key: string;
  parentKey?: string;
  settings: AudioChainSettings;
  takesNote: boolean;
};

export function graphChains(graph: AuditionChainGraph, sampleRate: number) {
  const chains: (GraphChain & { pathLatency: number })[] = [];
  const visit = (
    { settings, inputs = [] }: AuditionChainGraph,
    key: string,
    parentKey: string | undefined,
    pathLatency: number,
  ) => {
    const latency =
      pathLatency +
      chainLatencyFrames(AUDIO_PROCESSORS, settings.stages, sampleRate);
    chains.push({
      key,
      parentKey,
      settings,
      takesNote: !inputs.length,
      pathLatency: latency,
    });
    for (const input of inputs) {
      visit(input, `${key}/${input.id}`, key, latency);
    }
  };
  visit(graph, "", undefined, 0);
  const slowest = Math.max(...chains.map((chain) => chain.pathLatency));
  return chains.map(
    ({ pathLatency, ...chain }): GraphChain =>
      chain.takesNote
        ? {
            ...chain,
            settings: { ...chain.settings, delayFrames: slowest - pathLatency },
          }
        : chain,
  );
}

type TrackChain = {
  // What voices connect to, from before the chains themselves can be made.
  input: GainNode;
  // Each of the graph's chains by its key, with what it was last told.
  nodes: Map<string, { node: AudioWorkletNode; posted: string }>;
  stack: AuditionStack;
  // Which chains the stack's graph has, which `nodes` are made for.
  shape: string;
  transport: ChainTransport;
};

type WorkletState = "idle" | "loading" | "ready" | "failed";

export class AuditionChains {
  private readonly wake: (context: AudioContext) => void;
  private context: AudioContext | null = null;
  private worklet: WorkletState = "idle";
  // The chain worklet's URL (see chain-worklet-url.ts), which only Vite can
  // resolve, so the app hands it over.
  workletUrl: string | undefined;
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
        nodes: new Map(),
        stack,
        shape: "",
        transport,
      };
      this.chains.set(stack.trackId, chain);
    } else if (chain.stack.playheadSeconds !== stack.playheadSeconds) {
      chain.transport = transport;
      for (const { node } of chain.nodes.values()) {
        postChainMessage(node, { type: "transport", ...transport });
      }
    }
    this.configure(context, chain, stack);
    this.connect(context, chain);
    return chain.input;
  }

  /** Has the open chains follow an edit: `resolve` gives each stack now. */
  update(
    resolve: (trackId: string, spanId?: string) => AuditionStack | undefined,
  ) {
    const { context } = this;
    if (!context) {
      return;
    }
    for (const [trackId, chain] of this.chains) {
      const stack = resolve(trackId, chain.stack.spanId);
      if (stack) {
        this.configure(context, chain, {
          ...stack,
          playheadSeconds: chain.stack.playheadSeconds,
        });
        this.connect(context, chain);
      } else {
        this.takeApart(chain);
        this.chains.delete(trackId);
      }
    }
  }

  private takeApart(chain: TrackChain) {
    for (const { node } of chain.nodes.values()) {
      node.disconnect();
    }
    chain.nodes.clear();
    chain.input.disconnect();
  }

  private configure(
    context: AudioContext,
    chain: TrackChain,
    stack: AuditionStack,
  ) {
    chain.stack = stack;
    const parts = graphChains(stack, context.sampleRate);
    const shape = parts.map(({ key }) => key).join();
    if (chain.nodes.size && shape !== chain.shape) {
      // Paths came or went, so `connect` builds the graph anew.
      this.takeApart(chain);
    }
    chain.shape = shape;
    for (const { key, settings } of parts) {
      const part = chain.nodes.get(key);
      const posted = JSON.stringify([settings, stack.tempo]);
      if (part && part.posted !== posted) {
        postChainMessage(part.node, {
          type: "configure",
          settings,
          tempo: stack.tempo,
        });
        part.posted = posted;
      }
    }
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
    if (this.worklet === "ready" && !chain.nodes.size) {
      const { tempo } = chain.stack;
      for (const { key, parentKey, settings, takesNote } of graphChains(
        chain.stack,
        context.sampleRate,
      )) {
        const node = createChainNode(context, {
          settings,
          tempo,
          transport: chain.transport,
        });
        chain.nodes.set(key, {
          node,
          posted: JSON.stringify([settings, tempo]),
        });
        // Parents come first, so there is one to connect to.
        node.connect(
          parentKey === undefined
            ? this.limiter(context)
            : (chain.nodes.get(parentKey)?.node as AudioNode),
        );
        if (takesNote) {
          chain.input.connect(node);
        }
      }
    }
    if (this.worklet === "failed") {
      chain.input.gain.value = this.gainAlone(chain.stack);
      chain.input.connect(context.destination);
    }
  }

  private async load(context: AudioContext) {
    this.worklet = "loading";
    try {
      if (!this.workletUrl) {
        throw new Error("No chain worklet URL");
      }
      await context.audioWorklet.addModule(this.workletUrl);
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
  private gainAlone({ settings, inputs }: AuditionChainGraph): number {
    return (
      settings.inputGain *
      steadyGainAmplitude(AUDIO_PROCESSORS, settings.stages) *
      (inputs
        ? inputs.reduce((sum, input) => sum + this.gainAlone(input), 0)
        : 1)
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
