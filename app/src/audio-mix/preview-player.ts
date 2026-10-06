// The media elements the preview mixer plays clips through (see
// preview-mixer.ts): how they seek, and how voices of the same media trade
// them. A video clip's element is a <video> the compositor also draws (see
// PreviewAudioMixer.videoElementFor), so the clip's media is fetched and
// demuxed once. Routed into Web Audio, the element sounds only through the
// mix, so it is never muted: Chromium feeds a muted element's silence into
// its MediaElementAudioSourceNode.
import { clamp } from "../app/util.ts";
import { type ClipWarp, loopMediaTime } from "../clip-warp.ts";
import { seekWhenReady } from "../media-seek.ts";
import { audioDiagnostics } from "./audio-diagnostics.ts";
import { isWebKit } from "./preview-graph.ts";
import type { AudioMixClip } from "./resolve.ts";

// The most a seek during playback aims ahead of the playhead to make up for
// how long seeks take to land.
const MAX_SEEK_LEAD_SECONDS = 0.5;
// HTMLMediaElement.HAVE_FUTURE_DATA: an element with this much can play.
const HAVE_FUTURE_DATA = 3;
const MAX_DRIFT_SECONDS = 0.18;
const SCRUB_DRIFT_SECONDS = 0.035;
// Audio keeps playing through a scrub started during playback, so it only
// re-syncs once it falls this far behind or ahead of the playhead.
const CONTINUOUS_SCRUB_DRIFT_SECONDS = 0.1;
// WebKit freezes an element routed into Web Audio for about 0.3 s, some
// 0.4 s after it starts playing or seeks (#1111). Re-seeking for the drift
// that leaves only freezes it again, every second or so, so in steady
// playback a WebKit element re-seeks only once it is further than
// STALLING_DRIFT_SECONDS off, which a freeze, longer on a busy device,
// stays within. The picture a <video> draws stays with its sound.
const STALLING_DRIFT_SECONDS = 0.6;
// The playback rates every browser accepts; a media element throws outside
// them.
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;

// A media element routed into Web Audio. Voices of the same media trade
// players, so its source moves to whichever voice's gain it plays for.
export type Player = {
  element: HTMLMediaElement;
  source: MediaElementAudioSourceNode;
  // Whether it is a <video> the compositor may draw.
  video: boolean;
  // The audio clock time its seek during playback was made, until it lands.
  seekStartedAt: number | null;
  // Whether it freezes after it starts or seeks, as in WebKit.
  stalls: boolean;
};

// What of a voice trading players reads and swaps.
export type PlayerVoice = {
  url: string;
  player: Player | null;
  gain: GainNode;
};

// How far an element may drift from the playhead before it seeks.
export function playbackDriftTolerance(playback: {
  isAudibleScrubbing: boolean;
  isContinuousScrubbing: boolean;
}) {
  if (!playback.isAudibleScrubbing) {
    return MAX_DRIFT_SECONDS;
  }
  return playback.isContinuousScrubbing
    ? CONTINUOUS_SCRUB_DRIFT_SECONDS
    : SCRUB_DRIFT_SECONDS;
}

// Whether `element` can play from where it is without waiting.
function isReady(element: HTMLMediaElement) {
  return element.readyState >= HAVE_FUTURE_DATA && !element.seeking;
}

// A player of `url`, a <video> for `video` media, which tells
// `onSeekLanded` how long each seek made during playback took to land, by
// the audio clock, and `stalls` after it starts or seeks.
export function createPlayer(
  context: AudioContext,
  url: string,
  video: boolean,
  onSeekLanded: (seconds: number) => void,
  stalls = isWebKit(),
): Player {
  const element = document.createElement(video ? "video" : "audio");
  element.crossOrigin = "anonymous";
  element.preload = "auto";
  if (video) {
    (element as HTMLVideoElement).playsInline = true;
  }
  element.src = url;
  // Routing through Web Audio is permanent; the element plays at full
  // volume into its voice's gain.
  const source = context.createMediaElementSource(element);
  const player: Player = {
    element,
    source,
    video,
    seekStartedAt: null,
    stalls,
  };
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

// Plays `player`'s media at `rate`, its clip's, within the rates every
// browser accepts.
export function setPlayerRate(player: Player, rate: number) {
  const clamped = clamp(rate, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE);
  if (player.element.playbackRate !== clamped) {
    player.element.playbackRate = clamped;
  }
}

// Seeks `player`'s element to `mediaTime` once it drifts further than
// `tolerance`, or in steady playback of an element that stalls, further
// than STALLING_DRIFT_SECONDS. In `steady` playback a seek still landing is
// left to land, and a new one aims `seekLatency`, as long as the last one
// took to land, ahead, so an element that starts late, as on a slow main
// thread, meets the playhead rather than chasing it from behind. Aiming past the end of
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
  const drift = element.currentTime - mediaTime;
  const playing = steady && !element.paused;
  if (playing) {
    audioDiagnostics.recordDrift(drift);
  }
  const steadyTolerance =
    player.stalls && playing
      ? Math.max(tolerance, STALLING_DRIFT_SECONDS)
      : tolerance;
  if (Math.abs(drift) <= steadyTolerance) {
    return;
  }
  audioDiagnostics.recordResync(playing);
  if (!steady || !context) {
    // A scrub queues no seeks behind one another on an element the
    // compositor draws.
    if (player.video) {
      seekWhenReady(element, mediaTime);
    } else {
      element.currentTime = mediaTime;
    }
    player.seekStartedAt = null;
    return;
  }
  element.currentTime = loopMediaTime(
    mediaTime + seekLatency * element.playbackRate,
    mediaDurationSeconds,
  );
  player.seekStartedAt = context.currentTime;
}

// A clip the compositor draws, in the fields that place its media on the
// timeline.
export type DrawnClip = {
  mediaId?: string;
  startSeconds: number;
  durationSeconds: number;
  sourceOffsetSeconds: number;
  sourceWindowStartSeconds: number;
  sourceWindowEndSeconds: number;
  warp?: ClipWarp;
};

const PLACEMENT_EPSILON_SECONDS = 1e-6;

// Whether the mix clip `audio` plays its media just where the compositor
// draws `drawn`, so one element can serve both: preview and export resolve
// both from the same layer clip pieces or source spans.
export function playsLike(audio: AudioMixClip, drawn: DrawnClip) {
  const near = (left: number, right: number) =>
    Math.abs(left - right) < PLACEMENT_EPSILON_SECONDS;
  return (
    audio.mediaId === drawn.mediaId &&
    near(audio.startSeconds, drawn.startSeconds) &&
    near(audio.durationSeconds, drawn.durationSeconds) &&
    near(audio.sourceOffsetSeconds, drawn.sourceOffsetSeconds) &&
    near(audio.sourceWindowStartSeconds, drawn.sourceWindowStartSeconds) &&
    near(audio.sourceWindowEndSeconds, drawn.sourceWindowEndSeconds) &&
    (audio.warp === drawn.warp ||
      JSON.stringify(audio.warp) === JSON.stringify(drawn.warp))
  );
}

// A media item, in the fields that tell video media and its container.
export type MixMediaItem = {
  id: string;
  kind?: string;
  name?: string;
  container?: string;
};

// Whether `item` is WebM media, whose <video> WebKit plays silently
// through a MediaElementAudioSourceNode (#1113).
export function isWebMMedia(item: MixMediaItem) {
  return item.container === "WebM" || /\.webm$/i.test(item.name ?? "");
}

// The mix's clips of video media, by media, to find the one a drawn clip
// plays.
export class MixVideoClips {
  private clipsByMediaId = new Map<string, AudioMixClip[]>();
  private webmIds = new Set<string>();

  update(clips: readonly AudioMixClip[], mediaItems: readonly MixMediaItem[]) {
    const videos = mediaItems.filter((item) => item.kind === "video");
    const videoIds = new Set(videos.map((item) => item.id));
    this.webmIds = new Set(videos.filter(isWebMMedia).map((item) => item.id));
    this.clipsByMediaId = new Map();
    for (const clip of clips) {
      if (videoIds.has(clip.mediaId)) {
        const placed = this.clipsByMediaId.get(clip.mediaId) ?? [];
        placed.push(clip);
        this.clipsByMediaId.set(clip.mediaId, placed);
      }
    }
  }

  isVideo(clip: AudioMixClip) {
    return this.clipsByMediaId.has(clip.mediaId);
  }

  // Whether `clip` plays WebM video media.
  isWebM(clip: AudioMixClip) {
    return this.webmIds.has(clip.mediaId);
  }

  // The clips of video media placed like `drawn`.
  placedLike(drawn: DrawnClip) {
    const clips = drawn.mediaId ? this.clipsByMediaId.get(drawn.mediaId) : [];
    return (clips ?? []).filter((clip) => playsLike(clip, drawn));
  }

  // The <video> of the voice (`voiceOf` a clip id) of a clip placed like
  // `drawn`, once it is made.
  elementFor(
    drawn: DrawnClip,
    voiceOf: (clipId: string) => { player: Player | null } | undefined,
  ) {
    for (const clip of this.placedLike(drawn)) {
      const player = voiceOf(clip.id)?.player;
      if (player?.video) {
        return player.element as HTMLVideoElement;
      }
    }
    return undefined;
  }
}
