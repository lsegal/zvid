import { pickMediaByPath } from "./app/session-project.ts";
import { basename, normalizeMediaPath } from "./app/util.ts";
import { isShapeEffectName, SHAPE_KEY } from "./fx/effects/shape/shape.ts";
import {
  customShapeMediaPath,
  customShapeValue,
} from "./fx/effects/shape/shapes/custom.ts";
import type { MediaItem } from "./media.ts";
import {
  PROJECT_ARCHIVE_MEDIA_DIR,
  type ProjectArchiveMediaInput,
  writeProjectArchive,
} from "./project-archive.ts";
import { collectShapeMediaPaths, type ProjectSession } from "./session.ts";

// File ▸ Export ▸ Project…: the `.zvd` archive written from a session. With
// media included, each file the session links goes in once under `media/`,
// and the session's paths to it are rewritten to that entry so the archive
// opens self-contained. A file that can't be read keeps its original path.

export const PROJECT_ARCHIVE_MIME_TYPE = "application/gzip";

function isLinkedPath(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Every media path the session links: its clips, its source tracks'
// recordings, its Custom shapes' SVGs and, in an older session, its main
// audio. Spellings of one
// path that differ only in case or separator count once.
export function collectLinkedMediaPaths(session: ProjectSession) {
  const paths = new Map<string, string>();
  const add = (value: unknown) => {
    if (!isLinkedPath(value)) return;
    const path = value.trim();
    const key = normalizeMediaPath(path);
    if (!paths.has(key)) paths.set(key, path);
  };
  for (const clip of session.clips ?? []) add(clip.filePath);
  for (const track of session.tracks ?? []) {
    for (const recording of track.recordings ?? []) add(recording.filename);
  }
  for (const path of collectShapeMediaPaths(session)) add(path);
  add(session.audioFilename);
  return Array.from(paths.values());
}

function splitExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

// The `media/<filename>` entry for each path, keyed by normalizeMediaPath.
// Filenames two paths share get a `-2`, `-3`… suffix, compared without case
// so the archive unpacks onto case-insensitive file systems too.
export function assignArchiveMediaPaths(paths: string[]) {
  const assigned = new Map<string, string>();
  const taken = new Set<string>();
  for (const path of paths) {
    const key = normalizeMediaPath(path.trim());
    if (assigned.has(key)) continue;
    const name = basename(path.trim());
    const filename = name === "." || name === ".." || !name ? "media" : name;
    const [stem, extension] = splitExtension(filename);
    let candidate = filename;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
      candidate = `${stem}-${n}${extension}`;
    }
    taken.add(candidate.toLowerCase());
    assigned.set(key, `${PROJECT_ARCHIVE_MEDIA_DIR}${candidate}`);
  }
  return assigned;
}

// The session with each linked path in `archivePaths` (keyed by
// normalizeMediaPath) swapped for its archive entry. Paths without one are
// left as they are.
export function rewriteSessionMediaPaths(
  session: ProjectSession,
  archivePaths: Map<string, string>,
): ProjectSession {
  const rewrite = <T>(value: T): T =>
    isLinkedPath(value)
      ? ((archivePaths.get(normalizeMediaPath(value.trim())) ?? value) as T)
      : value;
  const rewritten: ProjectSession = { ...session };
  if (session.clips) {
    rewritten.clips = session.clips.map((clip) => ({
      ...clip,
      filePath: rewrite(clip.filePath),
    }));
  }
  if (session.tracks) {
    rewritten.tracks = session.tracks.map((track) =>
      track.recordings
        ? {
            ...track,
            recordings: track.recordings.map((recording) => ({
              ...recording,
              filename: rewrite(recording.filename),
            })),
          }
        : track,
    );
  }
  if (session.audioFilename !== undefined) {
    rewritten.audioFilename = rewrite(session.audioFilename);
  }
  if (session.effects) {
    // A Custom shape names its SVG in its Shape parameter.
    rewritten.effects = session.effects.map((effect) => {
      const shape = effect.parameters?.[SHAPE_KEY];
      const path = isShapeEffectName(effect.effectName)
        ? customShapeMediaPath(shape?.stringValue)
        : undefined;
      return path
        ? {
            ...effect,
            parameters: {
              ...effect.parameters,
              [SHAPE_KEY]: {
                ...shape,
                stringValue: customShapeValue(rewrite(path)),
              },
            },
          }
        : effect;
    });
  }
  if (session.mediaRanges) {
    rewritten.mediaRanges = session.mediaRanges.map((range) => ({
      ...range,
      path: rewrite(range.path),
    }));
  }
  return rewritten;
}

export type ProjectArchiveExport = {
  blob: Blob;
  // The linked paths left out because their media couldn't be read.
  skipped: string[];
};

// Builds the `.zvd` for `session`. With `includeMedia`, each linked path is
// matched to one of `mediaItems` and read with `readMedia`, which returns
// undefined or throws when the media is offline.
export async function buildProjectArchive({
  session,
  includeMedia,
  mediaItems,
  readMedia,
}: {
  session: ProjectSession;
  includeMedia: boolean;
  mediaItems: MediaItem[];
  readMedia: (item: MediaItem) => Promise<Blob | undefined>;
}): Promise<ProjectArchiveExport> {
  if (!includeMedia) {
    return {
      blob: await writeProjectArchive({ project: session, media: [] }),
      skipped: [],
    };
  }

  const paths = collectLinkedMediaPaths(session);
  const archivePaths = assignArchiveMediaPaths(paths);
  const media: ProjectArchiveMediaInput[] = [];
  const included = new Map<string, string>();
  const skipped: string[] = [];
  for (const path of paths) {
    const key = normalizeMediaPath(path);
    const archivePath = archivePaths.get(key);
    const item = pickMediaByPath(mediaItems, path);
    let blob: Blob | undefined;
    try {
      blob = item ? await readMedia(item) : undefined;
    } catch {
      blob = undefined;
    }
    if (!blob || !archivePath) {
      skipped.push(path);
      continue;
    }
    media.push({ path: archivePath, blob });
    included.set(key, archivePath);
  }

  return {
    blob: await writeProjectArchive({
      project: rewriteSessionMediaPaths(session, included),
      media,
    }),
    skipped,
  };
}
