import type { AlsImportSummary } from "./als-import.ts";

export type LvpSession = {
  mainTracks?: Array<{ id: string; name: string; colorIndex?: number }>;
  tracks?: Array<{
    id: string;
    name: string;
    colorIndex?: number;
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
  }>;
  effects?: Array<{
    id: string;
    trackId: string;
    effectName: string;
    parameters?: Record<string, { floatValue?: number; stringValue?: string }>;
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
  };
  playPosition?: number;
  playStartPosition?: number;
  audioFilename?: string;
  sessionFile?: string;
  // Set on sessions saved since every session got a default Order effect;
  // without it the session is older and opens with one added. Anything that
  // writes a session must set it, or a removed Order comes back on open.
  orderDefaulted?: boolean;
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

// Every media file the session references: its clips and main audio.
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

  return Array.from(mediaPaths);
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
