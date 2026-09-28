// A minimal zip reader for the ZVID Capture installer build step: it lists a
// zip's entries from its central directory and inflates one at a time with
// DecompressionStream, so it runs in Node and the browser alike. It reads
// stored and deflated entries only, and no zip64 archives.

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
};

export class ZipError extends Error {}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// The end-of-central-directory record sits in the last 22 bytes plus up to
// 64 KiB of archive comment.
function findEndOfCentralDirectory(data: DataView) {
  const last = data.byteLength - 22;
  const first = Math.max(0, last - 0xffff);
  for (let offset = last; offset >= first; offset -= 1) {
    if (data.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new ZipError("not a zip archive");
}

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const data = view(bytes);
  const end = findEndOfCentralDirectory(data);
  const count = data.getUint16(end + 10, true);
  let offset = data.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    throw new ZipError("zip64 archives are not supported");
  }

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (data.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new ZipError("corrupt zip central directory");
    }
    const nameLength = data.getUint16(offset + 28, true);
    const extraLength = data.getUint16(offset + 30, true);
    const commentLength = data.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
      method: data.getUint16(offset + 10, true),
      compressedSize: data.getUint32(offset + 20, true),
      size: data.getUint32(offset + 24, true),
      localHeaderOffset: data.getUint32(offset + 42, true),
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const data = view(bytes);
  const header = entry.localHeaderOffset;
  if (data.getUint32(header, true) !== LOCAL_FILE_HEADER) {
    throw new ZipError(`corrupt zip entry ${entry.name}`);
  }
  // The local header's own name and extra lengths can differ from the
  // central directory's, so the data offset comes from the local header.
  const start =
    header +
    30 +
    data.getUint16(header + 26, true) +
    data.getUint16(header + 28, true);
  const compressed = bytes.subarray(start, start + entry.compressedSize);

  let contents: Uint8Array;
  if (entry.method === STORED) {
    contents = compressed;
  } else if (entry.method === DEFLATED) {
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    contents = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    throw new ZipError(
      `zip entry ${entry.name} uses unsupported compression method ${entry.method}`,
    );
  }

  if (contents.byteLength !== entry.size) {
    throw new ZipError(
      `zip entry ${entry.name} is ${contents.byteLength} bytes, expected ${entry.size}`,
    );
  }
  return contents;
}
