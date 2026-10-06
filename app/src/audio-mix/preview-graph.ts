// The preview mixer's output graph (see preview-mixer.ts): the master gain,
// the limiter, the analyser and VU meter tap beside it, and the preview
// volume.
import type { PreviewVolume } from "../app/preview-volume.ts";
import {
  createBandAnalyser,
  createMeterTap,
  type MasterMeterTap,
} from "../fx-shaders/audio-bands.ts";
import { audioDiagnostics } from "./audio-diagnostics.ts";
import { PARAMETER_RAMP_SECONDS } from "./chain.ts";
import { LIMITER_HEADROOM, limiterCurve } from "./mix.ts";

export type MixGraph = {
  context: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  meter: MasterMeterTap;
  output: GainNode;
};

// The parts of `navigator` that tell iOS apart.
type PlatformNavigator = Pick<
  Navigator,
  "userAgent" | "platform" | "maxTouchPoints"
>;

// Whether the page runs in iOS or iPadOS WebKit, which every browser there
// uses. iPadOS reports itself as a Mac, but with touch.
export function isIOSWebKit(
  platform: PlatformNavigator | undefined = globalThis.navigator,
) {
  if (!platform) {
    return false;
  }
  return (
    /iPhone|iPad|iPod/.test(platform.userAgent) ||
    (platform.platform === "MacIntel" && platform.maxTouchPoints > 1)
  );
}

// Whether the page runs in WebKit: Safari, or any iOS browser.
export function isWebKit(
  platform: PlatformNavigator | undefined = globalThis.navigator,
) {
  if (!platform) {
    return false;
  }
  return (
    isIOSWebKit(platform) ||
    (/AppleWebKit\//.test(platform.userAgent) &&
      !/(Chrome|Chromium|Edg|OPR|Android)\//.test(platform.userAgent))
  );
}

// The preview context's options. iOS WebKit underruns on the "interactive"
// default's small buffers when the main thread is busy (#1111), so there it
// asks for "playback" buffers; desktop browsers keep the default, whose
// lower output latency keeps the mix with the picture.
export function mixContextOptions(iOS = isIOSWebKit()): AudioContextOptions {
  return iOS ? { latencyHint: "playback" } : {};
}

// Tells Safari (16.4+) the page plays media, as a video editor's preview
// does, rather than ambient sound, which iOS may duck, interrupt, or mute
// with the ring/silent switch.
export function claimPlaybackAudioSession(
  platform:
    | { audioSession?: { type: string } }
    | undefined = globalThis.navigator as
    | { audioSession?: { type: string } }
    | undefined,
) {
  const session = platform?.audioSession;
  if (session && session.type !== "playback") {
    try {
      session.type = "playback";
    } catch {
      // Not settable here; the default session still plays.
    }
  }
}

// A new AudioContext's graph, its master at `masterAmplitude` and its
// output at `volume`.
export function createMixGraph(
  masterAmplitude: number,
  volume: PreviewVolume,
): MixGraph {
  claimPlaybackAudioSession();
  const context = new AudioContext(mixContextOptions());
  audioDiagnostics.addContext("preview", context);
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
