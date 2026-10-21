// The preview mixer's output graph (see preview-mixer.ts): the master gain,
// the limiter, the analyser and VU meter tap beside it, the preview volume,
// and the scrub filter after it.
import type { PreviewVolume } from "../app/preview-volume.ts";
import {
  createBandAnalyser,
  createMeterTap,
  type MasterMeterTap,
} from "../fx-shaders/audio-bands.ts";
import { audioDiagnostics } from "./audio-diagnostics.ts";
import { PARAMETER_RAMP_SECONDS } from "./chain.ts";
import { LIMITER_HEADROOM, limiterCurve } from "./mix.ts";
import { ScrubDrone } from "./scrub-drone.ts";

// What of the playback the scrub filter and drone follow.
export type ScrubPlayback = {
  isPlaying: boolean;
  isScrubbing: boolean;
  isAudibleScrubbing: boolean;
};

export type MixGraph = {
  context: AudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  meter: MasterMeterTap;
  output: GainNode;
  // Crossfades the speakers to the scrub high-pass while the scrub is
  // audible, and back to the dry mix after, and drones while the ruler is
  // held (see scrub-drone.ts).
  syncScrub: (playback: ScrubPlayback) => void;
};

// The scrub high-pass's cutoff, chosen by ear: a scrub keeps voices and
// melody, losing the low end that glitches.
export const SCRUB_HIGH_PASS_HZ = 300;
// A Butterworth response, in the dB the BiquadFilterNode takes its Q in,
// so the cutoff has no resonant bump.
const BUTTERWORTH_Q_DB = -3.01;
// The crossfade's time constant: settled within about 0.1 s, slow enough
// not to click, quick enough to follow a short scrub.
const SCRUB_FADE_SECONDS = 0.025;

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
  const setScrubbing = createScrubFilter(context, output);
  const drone = new ScrubDrone(context, limiter, output);
  const syncScrub = (playback: ScrubPlayback) => {
    setScrubbing(playback.isAudibleScrubbing);
    drone.sync({
      active: playback.isScrubbing && !playback.isPlaying,
      capturing: playback.isAudibleScrubbing,
    });
  };
  return { context, master, analyser, meter: meter.tap, output, syncScrub };
}

// Feeds `input` to the speakers both dry and through a high-pass, the dry
// path alone open, and returns what crossfades between them. Scrubbing
// re-seeks rapidly, which glitches hardest in the low end, so a scrub
// sounds rougher the more bass the mix has; the high-pass cuts it while
// scrubbing. Playback hears only the dry path, and export never passes here.
export function createScrubFilter(context: AudioContext, input: AudioNode) {
  const dry = context.createGain();
  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = SCRUB_HIGH_PASS_HZ;
  highPass.Q.value = BUTTERWORTH_Q_DB;
  const wet = context.createGain();
  wet.gain.value = 0;
  input.connect(dry);
  input.connect(highPass);
  highPass.connect(wet);
  dry.connect(context.destination);
  wet.connect(context.destination);
  let engaged = false;
  return (scrubbing: boolean) => {
    if (engaged === scrubbing) {
      return;
    }
    engaged = scrubbing;
    fadeTo(dry.gain, scrubbing ? 0 : 1, context);
    fadeTo(wet.gain, scrubbing ? 1 : 0, context);
  };
}

// Ramps `param` to `value`, from wherever an unfinished fade has it.
function fadeTo(param: AudioParam, value: number, context: AudioContext) {
  if (typeof param.setTargetAtTime !== "function") {
    param.value = value;
    return;
  }
  const now = context.currentTime;
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.setTargetAtTime(value, now, SCRUB_FADE_SECONDS);
  // Lands exactly, so playback's dry path is the mix itself.
  param.setValueAtTime(value, now + SCRUB_FADE_SECONDS * 10);
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
