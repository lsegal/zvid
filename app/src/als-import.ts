import {
  type AlsSkippedClip,
  type AlsSkipReason,
  convertAls,
  siblingAudioFilename,
} from "./import/als/convert.ts";
import { type AlsDocument, parseAlsXml } from "./import/als/parse.ts";
import type { LvpSession, ServerMediaRef } from "./session.ts";

// Opening an Ableton Live set (.als) as a zvid session. The set only names the
// Layers recordings and audio samples it uses, so the harnesses locate those
// files on disk and probe them before the session reaches the editor.

// What the converter reports alongside the session it produced. The skipped
// entries name clips that were dropped.
export type AlsImportReport = {
  skippedTracks?: string[];
  /** False when no imported clip plays a Layers recording. */
  hasLayersVideo?: boolean;
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
};

export type RecordingProbe = {
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
  "shorter-than-frame": "shorter than a frame",
};

// What the import summary lists as skipped: each dropped clip and why.
function describeSkipped(skipped: AlsSkippedClip[]) {
  return skipped.map(
    (clip) =>
      `${clip.clipName || clip.clipId} on ${clip.trackName} (${SKIP_REASONS[clip.reason]})`,
  );
}

// The Layers app kept a set's mixdown as `<name>.wav` beside the set. When
// that file exists it opens as the imported session's master audio.
export function alsMasterAudioPath(
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
  /** Mixdown audio for the set, usually from `alsMasterAudioPath`. */
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

// Live saves sample paths as absolute paths; Layers recordings are bare names.
function isAbsolutePath(rawPath: string) {
  return /^(?:[/\\]|[A-Za-z]:[/\\])/.test(rawPath);
}

// Every file a set's media could be at, for harnesses that check existence in
// one batch.
export function alsMediaCandidatePaths(session: LvpSession, dirs: string[]) {
  return collectAlsMediaNames(session).flatMap((name) => [
    ...(isAbsolutePath(name) ? [name] : []),
    ...dirs.map((dir) => joinPath(dir, basename(name))),
  ]);
}

// Finds a media file at its saved absolute path, or by name in the first
// search folder that has it.
export function createAlsMediaLocator(
  dirs: string[],
  exists: (path: string) => boolean,
) {
  return (name: string) => {
    if (isAbsolutePath(name) && exists(name)) {
      return name;
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
    summary: {
      tracks: session.tracks?.length ?? 0,
      clips: session.clips?.length ?? 0,
      skippedTracks: importReport?.skippedTracks ?? [],
      missingMedia: Array.from(missing),
      ...(importReport?.hasLayersVideo === false && { noLayersVideo: true }),
    } satisfies AlsImportSummary,
  };
}

// Fills each located recording's frame count and rate from the file itself.
// A recording that cannot be probed is left as it is.
export async function probeAlsRecordings(
  session: LvpSession,
  recordingRefs: Array<Pick<ServerMediaRef, "path" | "url" | "exists">>,
  probe: (url: string) => Promise<RecordingProbe | null>,
): Promise<LvpSession> {
  const probes = new Map<string, RecordingProbe>();
  await Promise.all(
    recordingRefs.map(async (ref) => {
      if (!ref.exists || !ref.url) {
        return;
      }

      try {
        const result = await probe(ref.url);
        if (result) {
          probes.set(ref.path, result);
        }
      } catch {
        // An unreadable recording still opens; it just lacks frame metadata.
      }
    }),
  );

  if (!probes.size) {
    return session;
  }

  return {
    ...session,
    tracks: session.tracks?.map((track) => ({
      ...track,
      recordings: track.recordings?.map((recording) => {
        const result = probes.get(recording.filename);
        return result ? { ...recording, ...result } : recording;
      }),
    })),
  };
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
  return lines;
}
