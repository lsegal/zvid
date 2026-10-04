import { inferMediaKind, withMediaType } from "../media.ts";
import type { ProjectArchiveMedia } from "../project-archive.ts";
import {
  collectSessionMediaPaths,
  type LvpSession,
  type ServerMediaRef,
  type SessionOpenResponse,
} from "../session.ts";

// Building the payload a session opens with: its media references resolved
// against the media bundled in a project archive, or left offline for a lone
// session file.

export function basename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

function normalizeMediaPath(rawPath: string) {
  return rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[a-z]:\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

export function createPathId(rawPath: string) {
  let hash = 0;
  for (let index = 0; index < rawPath.length; index += 1) {
    hash = (hash * 31 + rawPath.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(16)}-${basename(rawPath)}`;
}

// Resolves a session's media path to a bundled file by its full path, or by
// its name when exactly one bundled file has that name.
function createArchiveMediaResolver(media: ProjectArchiveMedia[]) {
  const byPath = new Map<string, ProjectArchiveMedia>();
  const byBasename = new Map<string, ProjectArchiveMedia | null>();

  for (const entry of media) {
    byPath.set(normalizeMediaPath(entry.path), entry);
    const name = basename(entry.path).toLowerCase();
    byBasename.set(name, byBasename.has(name) ? null : entry);
  }

  return (rawPath: string) =>
    byPath.get(normalizeMediaPath(rawPath)) ??
    byBasename.get(basename(rawPath).toLowerCase()) ??
    null;
}

export function buildArchiveOpenPayload(
  session: LvpSession,
  sessionName: string,
  media: ProjectArchiveMedia[],
): SessionOpenResponse {
  const resolveFile = createArchiveMediaResolver(media);
  const mediaRefs = collectSessionMediaPaths(session).map<ServerMediaRef>(
    (rawPath) => {
      const entry = resolveFile(rawPath);
      return {
        id: createPathId(rawPath),
        path: rawPath,
        name: basename(rawPath),
        url: entry
          ? URL.createObjectURL(
              withMediaType(entry.file, inferMediaKind(rawPath)),
            )
          : "",
        exists: Boolean(entry),
      };
    },
  );

  return { session, sessionName, mediaRefs };
}

export function buildFileOpenPayload(
  session: LvpSession,
  sessionName: string,
): SessionOpenResponse {
  // A lone session file carries no media, so every reference opens as missing.
  const mediaRefs = collectSessionMediaPaths(session).map<ServerMediaRef>(
    (rawPath) => ({
      id: createPathId(rawPath),
      path: rawPath,
      name: basename(rawPath),
      url: "",
      exists: false,
    }),
  );

  return { session, sessionName, mediaRefs };
}
