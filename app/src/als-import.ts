import {
  type AlsSkippedClip,
  type AlsSkipReason,
  convertAls,
  siblingAudioFilename,
} from "./import/als/convert.ts";
import {
  type AlsDocument,
  parseAlsXml,
  type RecordRoot,
} from "./import/als/parse.ts";
import type { LvpSession, ServerMediaRef } from "./session.ts";
import {
  applySessionFormat,
  detectSessionFormat,
  probeRefs,
  type VideoFormatProbe,
} from "./session-format.ts";

// Opening an Ableton Live set (.als) as a zvid session. The set only names the
// Layers recordings and audio samples it uses, so the harnesses locate those
// files on disk and probe them before the session reaches the editor.

// What the converter reports alongside the session it produced. The skipped
// entries name clips that were dropped.
export type AlsImportReport = {
  skippedTracks?: string[];
  /** False when no imported clip plays a Layers recording. */
  hasLayersVideo?: boolean;
  /** Where each ZVID Capture recording was saved, by filename. */
  recordRoots?: Record<string, RecordRoot>;
  /** Tracks whose clips play a Layers Record recording, by id. */
  layersRecordTracks?: string[];
};

export type ImportedAlsSession = LvpSession & {
  importReport?: AlsImportReport;
};

export type AlsImportSummary = {
  tracks: number;
  clips: number;
  skippedTracks: string[];
  missingMedia: string[];
  /** Set when the set had no Layers video, so every clip is a placeholder. */
  noLayersVideo?: boolean;
  /** Notes on the canvas size and frame rate detected from the media. */
  formatNotes?: string[];
};

export type RecordingProbe = VideoFormatProbe & {
  numFrames: number;
  frameRate: number;
};

export class AlsImportError extends Error {
  name = "AlsImportError";
}

function basename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

export function isAlsFilename(name: string) {
  return name.trim().toLowerCase().endsWith(".als");
}

// Live sets are gzip-compressed XML, so the gzip magic identifies one even
// when the file has been renamed.
export function isGzipBytes(bytes: Uint8Array) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function isAlsSession(bytes: Uint8Array, name: string) {
  return isGzipBytes(bytes) || isAlsFilename(name);
}

// Ableton writes a timestamped copy of the set into `Backup/` on every save.
export function isAlsBackupPath(rawPath: string) {
  const segments = rawPath.split(/[/\\]/).filter(Boolean);
  return isAlsFilename(rawPath) && segments.at(-2)?.toLowerCase() === "backup";
}

// Session files a workspace can open, best first: `.lvp` sessions, then Live
// sets (ignoring Ableton's backups), then bare JSON.
export function rankWorkspaceSessions<T extends { path: string }>(files: T[]) {
  const byExtension = (extension: string) =>
    files.filter((entry) => entry.path.toLowerCase().endsWith(extension));
  const lvp = byExtension(".lvp");
  if (lvp.length) {
    return lvp;
  }

  const als = byExtension(".als").filter(
    (entry) => !isAlsBackupPath(entry.path),
  );
  return als.length ? als : byExtension(".json");
}

// An imported set is never written back: saves target the sibling `.lvp`.
export function alsSavePath(alsPath: string) {
  return alsPath.replace(/\.als$/i, ".lvp");
}

export async function readAlsXml(bytes: Uint8Array, name = "This file") {
  if (!isGzipBytes(bytes)) {
    throw new AlsImportError(
      `${name} is not an Ableton Live set: Live sets are gzip-compressed and this file is not.`,
    );
  }

  let xml: string;
  try {
    const stream = new Response(bytes as BodyInit).body?.pipeThrough(
      new DecompressionStream("gzip"),
    );
    xml = await new Response(stream).text();
  } catch {
    throw new AlsImportError(
      `${name} could not be decompressed. The Live set may be damaged or incomplete.`,
    );
  }

  if (!/<Ableton[\s>]/.test(xml.slice(0, 4096))) {
    throw new AlsImportError(`${name} is not an Ableton Live set.`);
  }

  return xml;
}

const SKIP_REASONS: Record<AlsSkipReason, string> = {
  disabled: "disabled",
  "no-recording": "no Layers recording",
  "no-take": "no ZVID take at its position",
  "shorter-than-frame": "shorter than a frame",
};

function describeClip(clip: AlsSkippedClip) {
  return `${clip.clipName || clip.clipId} on ${clip.trackName}`;
}

// What the import summary lists as skipped: each dropped clip and why.
function describeSkipped(skipped: AlsSkippedClip[]) {
  return skipped.map(
    (clip) => `${describeClip(clip)} (${SKIP_REASONS[clip.reason]})`,
  );
}

// The Layers app kept a set's mixdown as `<name>.wav` beside the set. When
// that file exists it opens as the imported session's main audio.
export function alsMainAudioPath(
  alsPath: string | undefined,
  exists: (path: string) => boolean,
) {
  if (!alsPath) {
    return undefined;
  }

  const audioPath = siblingAudioFilename(alsPath);
  return exists(audioPath) ? audioPath : undefined;
}

type ImportAlsOptions = {
  /** Mixdown audio for the set, usually from `alsMainAudioPath`. */
  audioFilename?: string;
};

async function convertAlsXml(
  xml: string,
  name: string,
  path: string | undefined,
  options: ImportAlsOptions,
): Promise<ImportedAlsSession> {
  let doc: AlsDocument;
  try {
    doc = parseAlsXml(xml);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AlsImportError(`${name} could not be read: ${reason}.`);
  }

  const { session, summary } = convertAls(doc, {
    sessionFile: path,
    audioFilename: options.audioFilename,
  });
  return {
    ...session,
    importReport: {
      skippedTracks: describeSkipped(summary.skipped),
      hasLayersVideo: summary.hasLayersVideo,
      ...(summary.recordRoots && { recordRoots: summary.recordRoots }),
      ...(summary.layersRecordTracks && {
        layersRecordTracks: summary.layersRecordTracks,
      }),
    },
  };
}

export async function importAls(
  bytes: Uint8Array,
  path?: string,
  options: ImportAlsOptions = {},
): Promise<ImportedAlsSession> {
  const name = path ? basename(path) : "This file";
  const xml = await readAlsXml(bytes, name);
  return convertAlsXml(xml, name, path, options);
}

function parentPath(rawPath: string) {
  const trimmed = rawPath.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) {
    return null;
  }

  return index === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, index);
}

export function joinPath(dir: string, ...parts: string[]) {
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const base = dir.replace(/[/\\]+$/, "");
  return [base, ...parts].join(separator);
}

// Where a set's media may live, in search order: the set's own folder, the
// `Recorded` folder beside the Ableton project, the old Layers app's default
// recording folder, then the project's recorded and imported samples.
export function alsMediaSearchDirs(
  alsPath: string | undefined,
  documentsDir: string | undefined,
) {
  const dirs: string[] = [];
  const projectDir = alsPath ? parentPath(alsPath) : null;
  if (projectDir) {
    dirs.push(projectDir);
    const projectParent = parentPath(projectDir);
    if (projectParent) {
      dirs.push(joinPath(projectParent, "Recorded"));
    }
  }

  if (documentsDir) {
    dirs.push(joinPath(documentsDir, "Layers", "Recorded"));
  }

  if (projectDir) {
    dirs.push(
      joinPath(projectDir, "Samples", "Recorded"),
      joinPath(projectDir, "Samples", "Imported"),
    );
  }

  return Array.from(new Set(dirs));
}

// The folder ZVID Capture recorded into: `Recorded/ZVID` in the set's own
// folder, or `ZVID/Recorded` in Documents.
export function alsRecordRootDir(
  root: RecordRoot,
  alsPath: string | undefined,
  documentsDir: string | undefined,
) {
  if (root === "documents") {
    return documentsDir ? joinPath(documentsDir, "ZVID", "Recorded") : null;
  }

  const projectDir = alsPath ? parentPath(alsPath) : null;
  return projectDir ? joinPath(projectDir, "Recorded", "ZVID") : null;
}

// The record root folder of each ZVID Capture recording in an imported set,
// by name. Other media has none.
export function alsRecordDirLocator(
  imported: ImportedAlsSession,
  alsPath: string | undefined,
  documentsDir: string | undefined,
) {
  const roots = imported.importReport?.recordRoots ?? {};
  return (name: string) => {
    const root = roots[name.trim()];
    return root
      ? (alsRecordRootDir(root, alsPath, documentsDir) ?? undefined)
      : undefined;
  };
}

// ZVID Capture saves filenames relative to its record root folder.
function recordRootCandidate(
  name: string,
  recordDirOf: ((name: string) => string | undefined) | undefined,
) {
  const dir = recordDirOf?.(name);
  return dir
    ? joinPath(dir, ...name.trim().split(/[/\\]/).filter(Boolean))
    : null;
}

// Live saves sample paths as absolute paths; Layers recordings are bare names.
function isAbsolutePath(rawPath: string) {
  return /^(?:[/\\]|[A-Za-z]:[/\\])/.test(rawPath);
}

// Every file a set's media could be at, for harnesses that check existence in
// one batch.
export function alsMediaCandidatePaths(
  session: LvpSession,
  dirs: string[],
  recordDirOf?: (name: string) => string | undefined,
) {
  return collectAlsMediaNames(session).flatMap((name) => [
    ...(isAbsolutePath(name) ? [name] : []),
    ...[recordRootCandidate(name, recordDirOf)].filter(
      (path): path is string => path !== null,
    ),
    ...dirs.map((dir) => joinPath(dir, basename(name))),
  ]);
}

// Finds a media file at its saved absolute path, in its ZVID Capture record
// root folder, or by name in the first search folder that has it.
export function createAlsMediaLocator(
  dirs: string[],
  exists: (path: string) => boolean,
  recordDirOf?: (name: string) => string | undefined,
) {
  return (name: string) => {
    if (isAbsolutePath(name) && exists(name)) {
      return name;
    }

    const recorded = recordRootCandidate(name, recordDirOf);
    if (recorded && exists(recorded)) {
      return recorded;
    }

    for (const dir of dirs) {
      const candidate = joinPath(dir, basename(name));
      if (exists(candidate)) {
        return candidate;
      }
    }

    return null;
  };
}

function collectAlsMediaNames(session: LvpSession) {
  const names = new Set<string>();
  for (const track of session.tracks ?? []) {
    for (const recording of track.recordings ?? []) {
      if (recording.filename?.trim()) {
        names.add(recording.filename.trim());
      }
    }
  }

  for (const clip of session.clips ?? []) {
    if (clip.filePath?.trim()) {
      names.add(clip.filePath.trim());
    }
  }

  return Array.from(names);
}

// Points every recording and clip at the file `locate` found for it. Files
// that were not found keep their name and open as offline media. Placeholder
// clips have no media and are left as they are.
export function resolveAlsMedia(
  imported: ImportedAlsSession,
  locate: (name: string) => string | null,
) {
  const { importReport, ...session } = imported;
  const resolved = new Map<string, string>();
  const missing = new Set<string>();
  for (const name of collectAlsMediaNames(session)) {
    const found = locate(name);
    if (found) {
      resolved.set(name, found);
    } else {
      missing.add(basename(name));
    }
  }

  const resolve = (name: string) => resolved.get(name.trim()) ?? name;
  const resolvedSession: LvpSession = {
    ...session,
    tracks: session.tracks?.map((track) => ({
      ...track,
      recordings: track.recordings?.map((recording) => ({
        ...recording,
        filename: resolve(recording.filename),
      })),
    })),
    clips: session.clips?.map((clip) => ({
      ...clip,
      filePath: resolve(clip.filePath),
    })),
  };

  return {
    session: resolvedSession,
    recordingPaths: Array.from(new Set(resolved.values())),
    layersRecordTracks: importReport?.layersRecordTracks ?? [],
    summary: {
      tracks: session.tracks?.length ?? 0,
      clips: session.clips?.length ?? 0,
      skippedTracks: importReport?.skippedTracks ?? [],
      missingMedia: Array.from(missing),
      ...(importReport?.hasLayersVideo === false && { noLayersVideo: true }),
    } satisfies AlsImportSummary,
  };
}

// Fills each located recording's frame count and rate from the file itself,
// then sets the session's canvas size and frame rate from the probed video
// (see `detectSessionFormat`). A recording that cannot be probed is left as it
// is, and without any probe the set's plugin metadata, or the defaults, stay.
// A measured rate close to the set's keeps the set's; one that differs
// rescales every frame position, so the clips keep their times. `formatNotes` are lines for the import
// summary, such as a note on mixed recording sizes.
//
// Layers lines each audio take on a `layersRecordTracks` track up with the end
// of its video rather than with the recording's stored `frameStart`, so once
// the video's length is known, each such clip's `captureOffset` becomes
// `round((numFrames / frameRate - audioFileDuration) * fps)`, which is
// `round(numFrames - audioFileDuration * fps)` when the video runs at the
// session's rate. The offset is per clip: clips playing different samples of
// one recording get different offsets. MIDI clips have no sample and ZVID
// Capture takes are aligned by the plugin's own clock, so both keep theirs.
export async function probeAlsRecordings(
  session: LvpSession,
  recordingRefs: Array<Pick<ServerMediaRef, "path" | "url" | "exists">>,
  probe: (url: string) => Promise<RecordingProbe | null>,
  layersRecordTracks: readonly string[] = [],
): Promise<{ session: LvpSession; formatNotes: string[] }> {
  const probes = await probeRefs(recordingRefs, probe);
  if (!probes.size) {
    return { session, formatNotes: [] };
  }

  const { notes, ...detected } = detectSessionFormat(
    Array.from(probes.values()),
    session.timeline?.fps,
  );
  const formatted = applySessionFormat(session, detected);
  const tracks = formatted.tracks?.map((track) => ({
    ...track,
    recordings: track.recordings?.map((recording) => {
      const result = probes.get(recording.filename);
      return result
        ? {
            ...recording,
            numFrames: result.numFrames,
            frameRate: result.frameRate,
          }
        : recording;
    }),
  }));
  const endAligned = new Set(layersRecordTracks);
  const fps = formatted.timeline?.fps;
  // Seconds of video, by track id and recording filename.
  const videoSeconds = new Map<string, number>();
  for (const track of tracks ?? []) {
    if (!endAligned.has(track.id)) continue;
    for (const { filename, numFrames, frameRate } of track.recordings ?? []) {
      if (numFrames !== undefined && frameRate) {
        videoSeconds.set(`${track.id}:${filename}`, numFrames / frameRate);
      }
    }
  }

  return {
    session: {
      ...formatted,
      tracks,
      clips: formatted.clips?.map((clip) => {
        const seconds = videoSeconds.get(`${clip.trackId}:${clip.filePath}`);
        const duration = clip.audioFileDuration;
        if (
          seconds === undefined ||
          typeof duration !== "number" ||
          !Number.isFinite(duration) ||
          !fps
        ) {
          return clip;
        }
        return {
          ...clip,
          captureOffset: Math.round((seconds - duration) * fps),
        };
      }),
    },
    formatNotes: notes,
  };
}

// The import summary with the notes from `probeAlsRecordings` added.
export function withFormatNotes(
  summary: AlsImportSummary,
  formatNotes: readonly string[],
): AlsImportSummary {
  return formatNotes.length
    ? { ...summary, formatNotes: [...formatNotes] }
    : summary;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatAlsImportSummary(
  summary: AlsImportSummary,
  name = "this set",
) {
  const imported = `${pluralize(summary.tracks, "track")} and ${pluralize(summary.clips, "clip")}`;
  const lines = [
    summary.noLayersVideo
      ? `No Layers video in ${name}. Imported ${imported} as placeholders.`
      : `Imported ${imported}.`,
  ];
  if (summary.skippedTracks.length) {
    lines.push(
      `Skipped ${pluralize(summary.skippedTracks.length, "track or clip", "tracks and clips")}: ${summary.skippedTracks.join(", ")}.`,
    );
  }
  if (summary.missingMedia.length) {
    lines.push(
      `${pluralize(summary.missingMedia.length, "media file")} could not be found and will open offline: ${summary.missingMedia.join(", ")}.`,
    );
  }
  lines.push(...(summary.formatNotes ?? []));
  return lines;
}
