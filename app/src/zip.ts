// A small zip reader, for dotLottie archives. It reads the central directory
// and inflates deflated entries with DecompressionStream, so it needs no
// library. Zip64, encryption and multi-part archives aren't supported.

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
// The end record is 22 bytes, then a comment of up to 65535.
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;

const STORED = 0;
const DEFLATED = 8;

type ZipEntry = {
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
};

export type ZipArchive = {
  /** The names of the archive's files, in its order. */
  names: string[];
  /** The bytes of the file `name`, or undefined when it has none. */
  read(name: string): Promise<Uint8Array | undefined>;
};

function findEnd(view: DataView) {
  const last = view.byteLength - END_SIZE;
  for (let at = last; at >= 0 && at >= last - MAX_COMMENT; at--) {
    if (view.getUint32(at, true) === END_SIGNATURE) {
      return at;
    }
  }
  return -1;
}

async function inflate(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The zip archive in `bytes`, or undefined when it doesn't hold one. */
export function readZip(bytes: Uint8Array): ZipArchive | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(view);
  if (end < 0) {
    return undefined;
  }
  const count = view.getUint16(end + 10, true);
  const directoryEnd =
    view.getUint32(end + 16, true) + view.getUint32(end + 12, true);
  if (directoryEnd > end) {
    return undefined;
  }
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let at = view.getUint32(end + 16, true);
  for (let index = 0; index < count; index++) {
    if (
      at + 46 > directoryEnd ||
      view.getUint32(at, true) !== CENTRAL_SIGNATURE
    ) {
      return undefined;
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (!name.endsWith("/")) {
      entries.set(name, {
        method: view.getUint16(at + 10, true),
        compressedSize: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        localOffset: view.getUint32(at + 42, true),
      });
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    async read(name) {
      const entry = entries.get(name);
      if (
        !entry ||
        entry.localOffset + 30 > bytes.byteLength ||
        view.getUint32(entry.localOffset, true) !== LOCAL_SIGNATURE
      ) {
        return undefined;
      }
      const start =
        entry.localOffset +
        30 +
        view.getUint16(entry.localOffset + 26, true) +
        view.getUint16(entry.localOffset + 28, true);
      const data = bytes.subarray(start, start + entry.compressedSize);
      if (data.byteLength !== entry.compressedSize) {
        return undefined;
      }
      if (entry.method === STORED) {
        return data;
      }
      if (entry.method !== DEFLATED) {
        return undefined;
      }
      const inflated = await inflate(data).catch(() => undefined);
      return inflated?.byteLength === entry.size ? inflated : undefined;
    },
  };
}
