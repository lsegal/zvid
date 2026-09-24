import {
  type AlsSkippedClip,
  type AlsSkipReason,
  convertAls,
} from "./import/als/convert.ts";
import {
  type AlsDocument,
  LAYERS_RECORD_PLUGIN_NAME,
  parseAlsXml,
} from "./import/als/parse.ts";
import type { LvpSession, ServerMediaRef } from "./session.ts";

// Opening an Ableton Live set (.als) as a zvid session. The set only names the
// Layers recordings it uses, so the harnesses locate those files on disk and
// probe them before the session reaches the editor.

// What the converter reports alongside the session it produced. The skipped
// entries name tracks without Layers video and clips that were dropped.
export type AlsImportReport = {
  skippedTracks?: string[];
};

export type ImportedAlsSession = LvpSession & {
  importReport?: AlsImportReport;
};

export type AlsImportSummary = {
  tracks: number;
  clips: number;
  skippedTracks: string[];
  missingMedia: string[];
};

export type RecordingProbe = {
  numFrames: number;
  frameRate: number;
};

// The name of the Layers plugin on every track that carries Layers video.
const LAYERS_PLUGIN_NAME = LAYERS_RECORD_PLUGIN_NAME;

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

function noLayersError(name: string) {
  return new AlsImportError(
    `${name} has no tracks with the ${LAYERS_PLUGIN_NAME} plugin, so there is no Layers video to import.`,
  );
}

const SKIP_REASONS: Record<AlsSkipReason, string> = {
  disabled: "disabled",
  "no-layers": `no ${LAYERS_PLUGIN_NAME}`,
  "no-recording": "no Layers recording",
  "shorter-than-frame": "shorter than a frame",
};

// What the import summary lists as skipped: each audio or MIDI track without
// Layers video once, then each clip dropped from a Layers track and why.
function describeSkipped(doc: AlsDocument, skipped: AlsSkippedClip[]) {
  const described = doc.tracks
    .filter(
      (track) =>
        !track.isVideoTrack &&
        (track.kind === "audio" || track.kind === "midi"),
    )
    .map((track) => `${track.name} (${SKIP_REASONS["no-layers"]})`);
  for (const clip of skipped) {
    if (clip.reason !== "no-layers") {
      described.push(
        `${clip.clipName || clip.clipId} on ${clip.trackName} (${SKIP_REASONS[clip.reason]})`,
      );
    }
  }

  return described;
}

async function convertAlsXml(
  xml: string,
  name: string,
  path?: string,
): Promise<ImportedAlsSession> {
  let doc: AlsDocument;
  try {
    doc = parseAlsXml(xml);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AlsImportError(`${name} could not be read: ${reason}.`);
  }

  if (!doc.tracks.some((track) => track.isVideoTrack)) {
    throw noLayersError(name);
  }

  const { session, summary } = convertAls(doc, { sessionFile: path });
  return {
    ...session,
    importReport: { skippedTracks: describeSkipped(doc, summary.skipped) },
  };
}

export async function importAls(
  bytes: Uint8Array,
  path?: string,
): Promise<ImportedAlsSession> {
  const name = path ? basename(path) : "This file";
  const xml = await readAlsXml(bytes, name);
  if (!xml.includes(LAYERS_PLUGIN_NAME)) {
    throw noLayersError(name);
  }

  return convertAlsXml(xml, name, path);
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

// Where a set's recordings may live, in search order: the set's own folder,
// the `Recorded` folder beside the Ableton project, then the old Layers app's
// default recording folder.
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

  return Array.from(new Set(dirs));
}

// Every file a set's recordings could be at, for harnesses that check
// existence in one batch.
export function alsMediaCandidatePaths(session: LvpSession, dirs: string[]) {
  return collectAlsMediaNames(session).flatMap((name) =>
    dirs.map((dir) => joinPath(dir, basename(name))),
  );
}

export function createAlsMediaLocator(
  dirs: string[],
  exists: (path: string) => boolean,
) {
  return (name: string) => {
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
// that were not found keep their name and open as offline media.
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

export function formatAlsImportSummary(summary: AlsImportSummary) {
  const lines = [
    `Imported ${pluralize(summary.tracks, "track")} and ${pluralize(summary.clips, "clip")}.`,
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
