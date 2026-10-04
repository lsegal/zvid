// The media elements the preview mixer plays clips through (see
// preview-mixer.ts): how they seek, and how voices of the same media trade
// them.
import { clamp } from "../app/util.ts";
import { loopMediaTime } from "../clip-warp.ts";

// The most a seek during playback aims ahead of the playhead to make up for
// how long seeks take to land.
const MAX_SEEK_LEAD_SECONDS = 0.5;
// HTMLMediaElement.HAVE_FUTURE_DATA: an element with this much can play.
const HAVE_FUTURE_DATA = 3;

// A media element routed into Web Audio. Voices of the same media trade
// players, so its source moves to whichever voice's gain it plays for.
export type Player = {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  // The audio clock time its seek during playback was made, until it lands.
  seekStartedAt: number | null;
};

// What of a voice trading players reads and swaps.
export type PlayerVoice = {
  url: string;
  player: Player | null;
  gain: GainNode;
};

// Whether `element` can play from where it is without waiting.
function isReady(element: HTMLMediaElement) {
  return element.readyState >= HAVE_FUTURE_DATA && !element.seeking;
}

// A player of `url`, which tells `onSeekLanded` how long each seek made
// during playback took to land, by the audio clock.
export function createPlayer(
  context: AudioContext,
  url: string,
  onSeekLanded: (seconds: number) => void,
): Player {
  const element = document.createElement("audio");
  element.crossOrigin = "anonymous";
  element.preload = "auto";
  element.src = url;
  // Routing through Web Audio is permanent; the element plays at full
  // volume into its voice's gain.
  const source = context.createMediaElementSource(element);
  const player: Player = { element, source, seekStartedAt: null };
  element.addEventListener("seeked", () => {
    if (player.seekStartedAt !== null) {
      onSeekLanded(
        clamp(
          context.currentTime - player.seekStartedAt,
          0,
          MAX_SEEK_LEAD_SECONDS,
        ),
      );
      player.seekStartedAt = null;
    }
  });
  return player;
}

// Gives `voice`, whose clip plays `mediaTime` now, a ready player of the
// same media from one of `voices` whose clip is not `playing` now, when its
// own would have to load or seek first: preferably one already there, as the
// previous clip's is when back-to-back clips play on through the media,
// else, when its own has not loaded, any ready one, which seeks faster
// than a fresh one loads. The
// voices trade players, so the other keeps one for when it plays again.
export function takeReadyPlayer(
  voices: ReadonlyMap<string, PlayerVoice>,
  voice: PlayerVoice,
  mediaTime: number,
  tolerance: number,
  playing: (clipId: string) => boolean,
) {
  const own = voice.player;
  if (!own) {
    return;
  }
  const near = (player: Player) =>
    Math.abs(player.element.currentTime - mediaTime) <= tolerance;
  if (isReady(own.element) && near(own)) {
    return;
  }
  const ownLoaded = own.element.readyState >= HAVE_FUTURE_DATA;
  let best: PlayerVoice | null = null;
  for (const [otherId, other] of voices) {
    const candidate = other.player;
    if (
      other === voice ||
      !candidate ||
      other.url !== voice.url ||
      !isReady(candidate.element) ||
      playing(otherId)
    ) {
      continue;
    }
    if (near(candidate)) {
      best = other;
      break;
    }
    if (!ownLoaded && !best) {
      best = other;
    }
  }
  if (!best?.player) {
    return;
  }
  const taken = best.player;
  own.source.disconnect();
  taken.source.disconnect();
  own.source.connect(best.gain);
  taken.source.connect(voice.gain);
  if (!own.element.paused) {
    own.element.pause();
  }
  best.player = own;
  voice.player = taken;
}

// Seeks `player`'s element to `mediaTime` once it drifts further than
// `tolerance`. In `steady` playback a seek still landing is left to land,
// and a new one aims `seekLatency`, as long as the last one took to land,
// ahead, so an element that starts late, as on a slow main thread, meets
// the playhead rather than chasing it from behind. Aiming past the end of
// media `mediaDurationSeconds` long loops back to its start, as the clip
// does.
export function seekPlayer(
  player: Player,
  mediaTime: number,
  tolerance: number,
  steady: boolean,
  mediaDurationSeconds: number,
  context: AudioContext | undefined,
  seekLatency: number,
) {
  const { element } = player;
  if (steady && element.seeking) {
    return;
  }
  if (Math.abs(element.currentTime - mediaTime) <= tolerance) {
    return;
  }
  if (!steady || !context) {
    element.currentTime = mediaTime;
    player.seekStartedAt = null;
    return;
  }
  element.currentTime = loopMediaTime(
    mediaTime + seekLatency * element.playbackRate,
    mediaDurationSeconds,
  );
  player.seekStartedAt = context.currentTime;
}
