// The interface an audio effect's DSP implements. Each audio effect folder
// may export `processor` from its processor.ts, an AudioEffectDsp; the
// generated fx/effects/processors.generated.ts collects them. The same
// processor runs in the preview, inside the chain worklet (see
// chain-worklet.ts), and in export and the offline audio bands (see mix.ts),
// both through AudioChain (see chain.ts), so the two hear the same DSP.

export type AudioTimeSignature = { numerator: number; denominator: number };

export const DEFAULT_TIME_SIGNATURE: AudioTimeSignature = {
  numerator: 4,
  denominator: 4,
};

// The session tempo, for effects synced to it.
export type AudioTempo = { bpm: number; signature: AudioTimeSignature };

// Where a block plays: its first frame's timeline second and the tempo, so
// LFOs and synced delays stay locked to the timeline in preview, scrubbing
// and export alike.
export type AudioBlockTime = AudioTempo & {
  sampleRate: number;
  timeSeconds: number;
};

// A stage's settings: its number parameters, which the host ramps, and its
// switches (enums and toggles, as strings), which the host crossfades.
export type AudioStageSettings = {
  numbers: Readonly<Record<string, number>>;
  switches: Readonly<Record<string, string>>;
};

// A block's parameters as a processor reads them.
export type AudioParameterBlock = {
  // The number parameter's value at every frame of the block: ramped over
  // PARAMETER_RAMP_SECONDS after an edit, otherwise constant.
  number(key: string): Float32Array;
  // Its value at the end of the block, exactly as stored once settled.
  value(key: string): number;
  // Whether it is still ramping during the block.
  changing(key: string): boolean;
  // A switch's value; the host crossfades between two processors, one at
  // each value, when it changes.
  switch(key: string): string;
};

export type AudioEffectProcessor = {
  // Processes one block: `input` and `output` hold one array per channel,
  // each `frames` long. Output never aliases input. A processor holds its
  // own state between blocks; the host makes a fresh one to reset it.
  process(
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number,
    params: AudioParameterBlock,
    time: AudioBlockTime,
  ): void;
};

// Changes what a clip reads from its media rather than processing its sound
// (Reverse). Offline renders read the mapped span; the preview switches the
// clip's voice to decoded-buffer playback, since a media element plays only
// forwards.
export type AudioSourceStage = {
  // The timeline second whose media the clip plays at timeline second
  // `seconds`, for a clip playing from `startSeconds` to `endSeconds`.
  readSeconds(
    seconds: number,
    span: { startSeconds: number; endSeconds: number },
    settings: AudioStageSettings,
  ): number;
};

export type AudioEffectDsp = {
  effectName: string;
  createProcessor(sampleRate: number, channels: number): AudioEffectProcessor;
  // How long it keeps sounding once its input falls silent (a reverb's
  // decay, a delay's feedback): its chain keeps running that long past a
  // clip's end. 0 when unset.
  tailSeconds?(settings: AudioStageSettings, tempo: AudioTempo): number;
  // How many frames late its output is (a limiter's lookahead); the chain
  // delays the other paths to match. 0 when unset.
  latencyFrames?(settings: AudioStageSettings, sampleRate: number): number;
  source?: AudioSourceStage;
};

// One device in a chain, as resolved from the session: plain data, so it
// can be posted to the chain worklet.
export type AudioStage = AudioStageSettings & {
  id: string;
  effectName: string;
  enabled: boolean;
};

export type AudioProcessorRegistry = ReadonlyMap<string, AudioEffectDsp>;

export function createProcessorRegistry(
  processors: readonly AudioEffectDsp[],
): AudioProcessorRegistry {
  return new Map(
    processors.map((processor) => [processor.effectName, processor]),
  );
}
