// Media files in the Origin Private File System, one file per media id under
// `media/`. Files are streamed in and read back as `File`s, so large videos
// never have to be held in memory as a single IndexedDB value.

import type { MediaBlobBackend } from "./media-store.ts";

export type OpfsWritable = WritableStream<Uint8Array> & {
  abort(reason?: unknown): Promise<void>;
};

export type OpfsFileHandle = {
  getFile(): Promise<File>;
  createWritable(): Promise<OpfsWritable>;
};

export type OpfsDirectoryHandle = {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsDirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
};

export const OPFS_MEDIA_DIRECTORY = "media";

function isNotFoundError(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "NotFoundError"
  );
}

// Media ids can contain characters that aren't valid in file names.
export function opfsMediaFileName(id: string) {
  return encodeURIComponent(id);
}

export function createOpfsMediaBackend(
  root: OpfsDirectoryHandle,
): MediaBlobBackend {
  let directory: Promise<OpfsDirectoryHandle> | null = null;
  const getDirectory = () => {
    directory ??= root
      .getDirectoryHandle(OPFS_MEDIA_DIRECTORY, { create: true })
      .catch((error) => {
        directory = null;
        throw error;
      });
    return directory;
  };

  return {
    kind: "opfs",
    async read(id) {
      const media = await getDirectory();
      try {
        const handle = await media.getFileHandle(opfsMediaFileName(id));
        return await handle.getFile();
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },
    async write(id, blob) {
      const media = await getDirectory();
      const handle = await media.getFileHandle(opfsMediaFileName(id), {
        create: true,
      });
      // The writable goes to a swap file that replaces the old contents only
      // when the stream closes, so a failed write leaves any old file intact.
      const writable = await handle.createWritable();
      try {
        await blob.stream().pipeTo(writable);
      } catch (error) {
        await writable.abort(error).catch(() => undefined);
        throw error;
      }
    },
    async remove(id) {
      const media = await getDirectory();
      try {
        await media.removeEntry(opfsMediaFileName(id));
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
    },
  };
}

// Returns an OPFS backend when the browser can stream files into OPFS from
// the main thread, or null so callers fall back to IndexedDB.
export async function openOpfsMediaBackend(): Promise<MediaBlobBackend | null> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.storage?.getDirectory !== "function" ||
    typeof FileSystemFileHandle === "undefined" ||
    typeof FileSystemFileHandle.prototype.createWritable !== "function"
  ) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    return createOpfsMediaBackend(root as unknown as OpfsDirectoryHandle);
  } catch {
    return null;
  }
}
