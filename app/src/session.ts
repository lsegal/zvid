import type { AlsImportSummary } from "./als-import.ts";
import { customShapeMediaPaths } from "./fx/effects/shape/shape.ts";
import type { EffectAnimation } from "./fx-animation-defaults.ts";
import type { EffectModulation } from "./fx-modulation-defaults.ts";
import type { SessionEncoding } from "./session-settings.ts";

// Fields marked zvid-only are written by zvid and ignored by the Layers app.
/** A zvid-only clip with no media, drawn by its main track's effects. */
export type LvpLayerClip = {
  id: string;
  mainTrackId: string;
  frameStart: number;
  frameEnd: number;
  selected?: boolean;
};

export type LvpSession = {
  mainTracks?: Array<{
    id: string;
    name: string;
    colorIndex?: number;
    /** zvid-only: `false` when the layer's FX are bypassed. */
    fxEnabled?: boolean;
    /** zvid-only: `true` when the layer is hidden. */
    hidden?: boolean;
  }>;
  tracks?: Array<{
    id: string;
    name: string;
    colorIndex?: number;
    /** zvid-only: `false` when the source track's FX are bypassed. */
    fxEnabled?: boolean;
    /** zvid-only: `true` when the source track's video is hidden. */
    hidden?: boolean;
    recordings?: Array<{
      filename: string;
      frameStart?: number;
      numFrames?: number;
      frameRate?: number;
    }>;
  }>;
  clips?: Array<{
    id: string;
    trackId: string;
    name?: string;
    frameStart: number;
    frameCount: number;
    frameOffset?: number;
    clipStart?: number;
    filePath: string;
    warpMarkers?: Array<{
      id: string;
      clipId: string;
      secTime: number;
      beatTime: number;
    }>;
    frameHiddenLoopEnd?: number;
    captureOffset?: number;
    /**
     * zvid-only, set on a warped clip whose start was trimmed: the linear
     * source position, in seconds, its warp is anchored at. Without it the
     * warp is anchored where the clip's source starts.
     */
    warpAnchorSeconds?: number;
    /** Seconds; the Layers app writes `"NaN"` for MIDI clips. */
    audioFileDuration?: number | "NaN";
  }>;
  selections?: Array<{
    id: number;
    trackId: string;
    mainTrackId: string;
    frameStart: number;
    frameEnd: number;
    selected?: boolean;
    /**
     * zvid-only, set on a slipped selection: its source track position minus
     * its song position, in seconds. Without it the selection shows its
     * track at its own position.
     */
    sourceTrackOffsetSeconds?: number;
    /**
     * zvid-only, written by older builds on a slipped selection: the clip
     * its source came from and its source position minus its song position,
     * in seconds. Read only when `sourceTrackOffsetSeconds` is missing.
     */
    sourceClipId?: string;
    sourceOffsetSeconds?: number;
  }>;
  /** zvid-only: fill clips, painted by their main track's Color effect. */
  fills?: LvpLayerClip[];
  /** zvid-only: text clips, styled by their main track's Text effect. */
  texts?: LvpLayerClip[];
  /**
   * zvid-only: FX clips, whose own effect stack adjusts everything beneath
   * them.
   */
  fxClips?: LvpLayerClip[];
  effects?: Array<{
    id: string;
    trackId: string;
    effectName: string;
    parameters?: Record<string, { floatValue?: number; stringValue?: string }>;
    /** zvid-only: `false` when the effect is bypassed. */
    enabled?: boolean;
    /** zvid-only: the effect's Animation modifier settings. */
    animation?: EffectAnimation;
    /** zvid-only: an audio effect's Modulation modifier settings. */
    modulation?: EffectModulation;
    /** zvid-only: `true` on a Gain added on open and not edited since. */
    defaulted?: boolean;
  }>;
  timeline?: {
    bpm?: number;
    fps?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    displaySeconds?: boolean;
    snapToBeat?: boolean;
    zoom?: number;
    projectDuration?: number;
    /** zvid-only: the export encoding from Session Settings. */
    encoding?: SessionEncoding;
  };
  playPosition?: number;
  playStartPosition?: number;
  // A main audio file, from sessions saved before audio came only from
  // clips. Opening one turns it into a source track; it is not written.
  audioFilename?: string;
  sessionFile?: string;
  /**
   * zvid-only: `true` while the source tracks are locked against edits.
   * Imported Live sets start locked; without it a session opens unlocked.
   */
  sourceTracksLocked?: boolean;
  /**
   * zvid-only: the In and Out points set on media, by file path, in seconds
   * from the start of the file.
   */
  mediaRanges?: Array<{ path: string; inSeconds: number; outSeconds: number }>;
  // Set on sessions saved since every session got a default Order effect;
  // without it the session is older and opens with one added. Anything that
  // writes a session must set it, or a removed Order comes back on open.
  orderDefaulted?: boolean;
  // Set on sessions saved since text and fill clips carried their own Text
  // and Color effects; without it the session is older and its layers' Text
  // and Color are moved onto those clips on open.
  clipContentEffects?: boolean;
  // Set on sessions saved since clips needed a Gain effect to make sound;
  // without it the session is older and its clips with sound get a 0 dB
  // Gain on open.
  audioGainDefaulted?: boolean;
};

export type ServerMediaRef = {
  id: string;
  path: string;
  name: string;
  url: string;
  exists: boolean;
};

export type SessionOpenResponse = {
  sessionName: string;
  sessionPath?: string;
  session: LvpSession;
  mediaRefs: ServerMediaRef[];
  // Present when the session was imported from an Ableton Live set.
  alsImport?: AlsImportSummary;
  // Located recordings of an imported Live set, for probing frame metadata.
  recordingRefs?: ServerMediaRef[];
};

/**
 * The video file frame a session clip starts at: its content start plus the
 * file frame at its content origin. Imported videos mark `captureOffset` as
 * -1, which is treated as 0.
 */
export function clipSourceFrame(
  clip: NonNullable<LvpSession["clips"]>[number],
) {
  const captureOffset =
    clip.captureOffset === -1 ? 0 : (clip.captureOffset ?? 0);
  return Math.max(
    0,
    (clip.clipStart ?? 0) + (clip.frameOffset ?? 0) + captureOffset,
  );
}

function isFilePath(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Every media file the session references: its clips, its Custom shapes'
// SVGs and, in an older session, its main audio.
export function collectSessionMediaPaths(session: LvpSession) {
  const mediaPaths = new Set<string>();

  for (const clip of session.clips ?? []) {
    if (isFilePath(clip.filePath)) {
      mediaPaths.add(clip.filePath.trim());
    }
  }

  if (isFilePath(session.audioFilename)) {
    mediaPaths.add(session.audioFilename.trim());
  }

  for (const path of collectShapeMediaPaths(session)) {
    mediaPaths.add(path);
  }

  return Array.from(mediaPaths);
}

// The SVG media the session's Custom shapes take their masks from.
export function collectShapeMediaPaths(session: LvpSession) {
  return customShapeMediaPaths(
    (session.effects ?? []).map((effect) => ({
      effectName: effect.effectName,
      enabled: effect.enabled,
      parameters: Object.entries(effect.parameters ?? {}).map(
        ([key, parameter]) => ({ key, value: parameter?.stringValue ?? "" }),
      ),
    })),
  );
}

// Session files are parsed JSON that the types are never checked against, so
// a clip can arrive without a `filePath`. Such a clip opens as a placeholder
// with no media, like an imported clip whose path is `""`, and is named in
// `clipsWithoutFile` so the open can report it instead of failing.
export function normalizeLvpSession(session: LvpSession) {
  const clipsWithoutFile: string[] = [];
  const clips = session.clips?.map((clip) => {
    if (typeof clip.filePath === "string") {
      return clip;
    }

    clipsWithoutFile.push(clip.name?.trim() || String(clip.id));
    return { ...clip, filePath: "" };
  });
  const tracks = session.tracks?.map((track) =>
    track.recordings?.some(
      (recording) => typeof recording.filename !== "string",
    )
      ? {
          ...track,
          recordings: track.recordings.map((recording) =>
            typeof recording.filename === "string"
              ? recording
              : { ...recording, filename: "" },
          ),
        }
      : track,
  );
  const normalized: LvpSession = { ...session, clips, tracks };
  if (clips === undefined) delete normalized.clips;
  if (tracks === undefined) delete normalized.tracks;
  if (
    session.audioFilename !== undefined &&
    typeof session.audioFilename !== "string"
  ) {
    delete normalized.audioFilename;
  }

  return { session: normalized, clipsWithoutFile };
}

export function formatClipsWithoutFile(clipNames: string[]) {
  const count = clipNames.length;
  return `${count} ${count === 1 ? "clip has" : "clips have"} no media file and opened as ${count === 1 ? "a placeholder" : "placeholders"}: ${clipNames.join(", ")}.`;
}
