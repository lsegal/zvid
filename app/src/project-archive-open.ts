import type { SessionSelection, WorkspaceFileRef } from "./harness/contracts.ts";
import { buildWorkspaceOpenPayload } from "./harness/workspace-open.ts";
import { readProjectArchive } from "./project-archive.ts";
import type { LvpSession, SessionOpenResponse } from "./session.ts";

// Opening a `.zvd` project archive: its `project.json` is the session and its
// `media/*` files are the media it links. The archive opens like a workspace
// folder, with the bundled files standing in for the files beside a session,
// so the session's `media/<name>` paths resolve to them.

export class ProjectArchiveError extends Error {
  name = "ProjectArchiveError";
}

// A `.zvd` is a gzip archive like an `.als` set, so the extension, not the
// gzip magic, tells the two apart.
export function isProjectArchiveFilename(name: string) {
  return name.trim().toLowerCase().endsWith(".zvd");
}

export async function unpackProjectArchive(bytes: Uint8Array, name: string) {
  try {
    const { project, media } = await readProjectArchive(bytes);
    const files: WorkspaceFileRef[] = media.map(({ path, file }) => ({
      path,
      file,
    }));
    return { session: project as LvpSession, files };
  } catch (error) {
    throw new ProjectArchiveError(`${name} is not a zvid project archive.`, {
      cause: error,
    });
  }
}

// Opens an archive picked on its own, or as the session of a workspace
// folder. In a folder its media paths resolve to its bundled files first,
// then to the folder's files as an `.lvp`'s would. Paths that resolve to
// neither open offline.
export async function openProjectArchive(
  bytes: Uint8Array,
  name: string,
  workspace?: Extract<SessionSelection, { kind: "workspace" }>,
): Promise<SessionOpenResponse> {
  const { session, files } = await unpackProjectArchive(bytes, name);
  if (workspace) {
    return buildWorkspaceOpenPayload(session, {
      ...workspace,
      // Later files win a path both have.
      files: [...workspace.files, ...files],
    });
  }

  // A lone archive has no workspace path to save back to.
  const { sessionPath: _, ...payload } = buildWorkspaceOpenPayload(session, {
    kind: "workspace",
    rootName: "",
    sessionPath: name,
    sessionFile: new File([], name),
    files,
  });
  return payload;
}
