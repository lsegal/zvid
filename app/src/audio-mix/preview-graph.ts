// The preview mixer's output graph (see preview-mixer.ts): the master gain,
// the limiter, the analyser and VU meter tap beside it, and the preview
// volume.
import type { PreviewVolume } from "../app/preview-volume.ts";
import {
  createBandAnalyser,
  createMeterTap,
  type MasterMeterTap,
} from "../fx-shaders/audio-bands.ts";
import { PARAMETER_RAMP_SECONDS } from "./chain.ts";
import { LIMITER_HEADROOM, limiterCurve } from "./mix.ts";

export type MixGraph = {
  context: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  meter: MasterMeterTap;
  output: GainNode;
};

// A new AudioContext's graph, its master at `masterAmplitude` and its
// output at `volume`.
export function createMixGraph(
  masterAmplitude: number,
  volume: PreviewVolume,
): MixGraph {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = masterAmplitude;
  // The WaveShaper's curve spans −1..1, so the mix is scaled into it and
  // the curve scales it back (see limiterCurve).
  const headroom = context.createGain();
  headroom.gain.value = 1 / LIMITER_HEADROOM;
  const limiter = context.createWaveShaper();
  limiter.curve = limiterCurve();
  const meter = createMeterTap(context);
  const analyser = createBandAnalyser(context);
  const output = context.createGain();
  output.gain.value = volume.muted ? 0 : volume.volume;
  master.connect(headroom);
  headroom.connect(limiter);
  limiter.connect(meter.input);
  limiter.connect(analyser);
  analyser.connect(output);
  output.connect(context.destination);
  return { context, master, analyser, meter: meter.tap, output };
}

// Sets `param` to `value`, ramping where the browser can so a live edit
// never clicks.
export function setSmoothly(
  param: AudioParam,
  value: number,
  context: AudioContext,
) {
  if (typeof param.setTargetAtTime !== "function") {
    param.value = value;
    return;
  }
  param.cancelScheduledValues(context.currentTime);
  param.setTargetAtTime(value, context.currentTime, PARAMETER_RAMP_SECONDS / 3);
}
