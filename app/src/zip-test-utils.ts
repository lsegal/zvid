// Writes small zip archives for tests: each file stored, or deflated with
// CompressionStream.

export type ZipFile = {
  name: string;
  data: string | Uint8Array;
  deflate?: boolean;
};

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function header(size: number, fields: [number, number, 2 | 4][]) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (const [at, value, width] of fields) {
    if (width === 2) {
      view.setUint16(at, value, true);
    } else {
      view.setUint32(at, value, true);
    }
  }
  return bytes;
}

/** A zip archive of `files`, in their order. */
export async function writeZip(files: ZipFile[]) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data =
      typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const stored = file.deflate ? await deflate(data) : data;
    const method = file.deflate ? 8 : 0;
    const crc = crc32(data);
    const local = header(30, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [8, method, 2],
      [14, crc, 4],
      [18, stored.length, 4],
      [22, data.length, 4],
      [26, name.length, 2],
    ]);
    directory.push(
      header(46, [
        [0, 0x02014b50, 4],
        [4, 20, 2],
        [6, 20, 2],
        [10, method, 2],
        [16, crc, 4],
        [20, stored.length, 4],
        [24, data.length, 4],
        [28, name.length, 2],
        [42, offset, 4],
      ]),
      name,
    );
    parts.push(local, name, stored);
    offset += local.length + name.length + stored.length;
  }
  const directorySize = directory.reduce((size, part) => size + part.length, 0);
  const end = header(22, [
    [0, 0x06054b50, 4],
    [8, files.length, 2],
    [10, files.length, 2],
    [12, directorySize, 4],
    [16, offset, 4],
  ]);
  return new Uint8Array(
    await new Blob(
      [...parts, ...directory, end].map((part) => part as BlobPart),
    ).arrayBuffer(),
  );
}
