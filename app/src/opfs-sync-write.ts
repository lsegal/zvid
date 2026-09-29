// Writes a blob into an OPFS file with a sync access handle, for browsers
// that only allow streaming into OPFS from a worker. Shared by the OPFS media
// worker and its tests.

// Early WebKit builds return promises from these methods; awaiting covers
// both the async and the sync versions of the API.
export type OpfsSyncAccessHandle = {
  write(buffer: Uint8Array, options: { at: number }): number | Promise<number>;
  truncate(size: number): void | Promise<void>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
};

export type OpfsSyncFileHandle = {
  createSyncAccessHandle(): Promise<OpfsSyncAccessHandle>;
};

export type OpfsSyncDirectoryHandle = {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<OpfsSyncFileHandle>;
  removeEntry(name: string): Promise<void>;
};

// Streams `blob` into `name` chunk by chunk, so the whole file is never held
// in memory. There is no swap file as with `createWritable`, so a failed write
// removes the partial file rather than leaving it to be read back.
export async function writeWithSyncAccessHandle(
  directory: OpfsSyncDirectoryHandle,
  name: string,
  blob: Blob,
) {
  const file = await directory.getFileHandle(name, { create: true });
  const access = await file.createSyncAccessHandle();
  let failure: unknown = null;
  try {
    await access.truncate(0);
    const reader = blob.stream().getReader();
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      let written = 0;
      while (written < value.byteLength) {
        const count = await access.write(value.subarray(written), {
          at: offset + written,
        });
        if (!count) {
          throw new Error("OPFS write made no progress");
        }
        written += count;
      }
      offset += written;
    }
    await access.flush();
  } catch (error) {
    failure = error;
  } finally {
    await Promise.resolve(access.close()).catch(() => undefined);
  }
  if (failure) {
    await directory.removeEntry(name).catch(() => undefined);
    throw failure;
  }
}
