import {
  collectSessionMediaPaths,
  type LvpSession,
  type ServerMediaRef,
  type SessionOpenResponse,
} from "../session.ts";
import type { SessionSelection, WorkspaceFileRef } from "./contracts.ts";

// Resolving a session's media paths against the files it was opened with: a
// workspace folder's files, or the media bundled in a project archive.

export function basename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

export function normalizeWorkspacePath(rawPath: string) {
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

export function createWorkspaceResolver(
  rootName: string,
  files: WorkspaceFileRef[],
) {
  const byPath = new Map<string, WorkspaceFileRef>();
  const byBasename = new Map<string, WorkspaceFileRef | null>();

  for (const entry of files) {
    byPath.set(normalizeWorkspacePath(entry.path), entry);
    const name = basename(entry.path).toLowerCase();
    byBasename.set(name, byBasename.has(name) ? null : entry);
  }

  return (rawPath: string) => {
    const normalized = normalizeWorkspacePath(rawPath);
    const rootIndex = normalized.lastIndexOf(`/${rootName.toLowerCase()}/`);
    const rootedPath =
      rootIndex >= 0
        ? normalized.slice(rootIndex + rootName.length + 2)
        : normalized;

    return (
      byPath.get(normalized) ??
      byPath.get(rootedPath) ??
      byBasename.get(basename(rawPath).toLowerCase()) ??
      null
    );
  };
}

export function buildWorkspaceOpenPayload(
  session: LvpSession,
  selection: Extract<SessionSelection, { kind: "workspace" }>,
): SessionOpenResponse {
  const resolveFile = createWorkspaceResolver(
    selection.rootName,
    selection.files,
  );
  const mediaRefs = collectSessionMediaPaths(session).map<ServerMediaRef>(
    (rawPath) => {
      const entry = resolveFile(rawPath);
      return {
        id: createPathId(rawPath),
        path: rawPath,
        name: basename(rawPath),
        url: entry ? URL.createObjectURL(entry.file) : "",
        exists: Boolean(entry),
      };
    },
  );

  return {
    session,
    sessionName: selection.sessionFile.name,
    sessionPath: `${selection.rootName}/${selection.sessionPath}`,
    mediaRefs,
  };
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
