import { buildArchiveOpenPayload } from "./harness/open-payload.ts";
import { ProjectArchiveError, readProjectArchive } from "./project-archive.ts";
import type { SessionOpenResponse } from "./session.ts";

// Opening a `.zvd` project archive: its `project.json` is the session and its
// `media/*` files are the media it links, so the session's `media/<name>`
// paths resolve to them.

// A `.zvd` is a gzip archive like an `.als` set, so the extension, not the
// gzip magic, tells the two apart.
export function isProjectArchiveFilename(name: string) {
  return name.trim().toLowerCase().endsWith(".zvd");
}

export async function unpackProjectArchive(bytes: Uint8Array, name: string) {
  try {
    return await readProjectArchive(bytes);
  } catch (error) {
    throw new ProjectArchiveError(`${name} is not a zvid project archive.`, {
      cause: error,
    });
  }
}

// Media paths that resolve to no bundled file open offline.
export async function openProjectArchive(
  bytes: Uint8Array,
  name: string,
): Promise<SessionOpenResponse> {
  const { project: session, media } = await unpackProjectArchive(bytes, name);
  return buildArchiveOpenPayload(session, name, media);
}
