import { isGzipBytes } from "./als-import.ts";
import type { LvpSession } from "./session.ts";

// The `.zvd` project archive: a gzip-compressed tar (ustar) stream holding the
// session as `project.json` and the media it links to under `media/`. Names
// that do not fit a ustar header (long or non-ASCII) are carried in PAX
// extended headers, so any standard `tar` can unpack the archive.

export const PROJECT_ARCHIVE_SESSION_PATH = "project.json";
export const PROJECT_ARCHIVE_MEDIA_DIR = "media/";

export type ProjectArchiveMediaInput = { path: string; blob: Blob };
export type ProjectArchiveMedia = { path: string; file: File };
export type ProjectArchive = {
  project: LvpSession;
  media: ProjectArchiveMedia[];
};

export class ProjectArchiveError extends Error {
  name = "ProjectArchiveError";
}

type Bytes = Uint8Array<ArrayBuffer>;

const BLOCK = 512;
// 11 octal digits is the largest size a ustar header holds.
const MAX_USTAR_SIZE = 8 ** 11 - 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Returns the archive path with any leading `./` removed, or null when it
// would land outside the archive root.
export function normalizeArchivePath(rawPath: string): string | null {
  if (rawPath.includes("\\") || rawPath.includes("\0")) return null;
  if (rawPath.startsWith("/") || /^[a-zA-Z]:/.test(rawPath)) return null;
  const segments = rawPath.split("/");
  while (segments[0] === ".") segments.shift();
  if (segments.length === 0 || segments.some((s) => s === "..")) return null;
  const path = segments.filter((s) => s !== "" && s !== ".").join("/");
  return path === "" ? null : path;
}

function isMediaPath(path: string) {
  return (
    path.startsWith(PROJECT_ARCHIVE_MEDIA_DIR) &&
    path.length > PROJECT_ARCHIVE_MEDIA_DIR.length
  );
}

/* Writing */

function writeString(
  block: Uint8Array,
  offset: number,
  size: number,
  text: string,
) {
  block.set(encoder.encode(text).subarray(0, size), offset);
}

function writeOctal(
  block: Uint8Array,
  offset: number,
  size: number,
  value: number,
) {
  writeString(
    block,
    offset,
    size,
    `${value.toString(8).padStart(size - 1, "0")}\0`,
  );
}

function tarHeader(name: string, size: number, type: string, mtime: number) {
  const block = new Uint8Array(BLOCK);
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, Math.min(size, MAX_USTAR_SIZE));
  writeOctal(block, 136, 12, mtime);
  block.fill(0x20, 148, 156);
  writeString(block, 156, 1, type);
  writeString(block, 257, 8, "ustar\u000000");
  let sum = 0;
  for (const byte of block) sum += byte;
  writeString(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

// A PAX record is `<length> <key>=<value>\n`, where the length counts itself.
function paxRecord(key: string, value: string) {
  const body = ` ${key}=${value}\n`;
  const bodyLength = encoder.encode(body).length;
  const digits = String(bodyLength).length;
  let length = bodyLength + digits;
  if (String(length).length > digits) length++;
  return `${length}${body}`;
}

function padding(size: number) {
  const remainder = size % BLOCK;
  return remainder === 0 ? null : new Uint8Array(BLOCK - remainder);
}

function* entryHeaders(path: string, size: number, mtime: number) {
  const needsPaxPath =
    encoder.encode(path).length > 99 || !/^[\x20-\x7e]*$/.test(path);
  const records =
    (needsPaxPath ? paxRecord("path", path) : "") +
    (size > MAX_USTAR_SIZE ? paxRecord("size", String(size)) : "");
  if (records) {
    const data = encoder.encode(records);
    yield tarHeader("PaxHeader", data.length, "x", mtime);
    yield data;
    const pad = padding(data.length);
    if (pad) yield pad;
  }
  const ustarName = needsPaxPath ? path.replace(/[^\x20-\x7e]/g, "_") : path;
  yield tarHeader(ustarName, size, "0", mtime);
}

type ArchiveEntry = { path: string; blob: Blob };

async function* tarChunks(entries: ArchiveEntry[]) {
  const mtime = Math.floor(Date.now() / 1000);
  for (const { path, blob } of entries) {
    yield* entryHeaders(path, blob.size, mtime);
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
    const pad = padding(blob.size);
    if (pad) yield pad;
  }
  yield new Uint8Array(BLOCK * 2);
}

function iteratorStream(chunks: AsyncGenerator<Bytes>) {
  return new ReadableStream<Bytes>({
    async pull(controller) {
      const { done, value } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

export async function writeProjectArchive({
  project,
  media,
}: {
  project: LvpSession;
  media: ProjectArchiveMediaInput[];
}): Promise<Blob> {
  const entries: ArchiveEntry[] = [
    {
      path: PROJECT_ARCHIVE_SESSION_PATH,
      blob: new Blob([JSON.stringify(project)], { type: "application/json" }),
    },
  ];
  const seen = new Set<string>();
  for (const item of media) {
    const path = normalizeArchivePath(item.path);
    if (!path || !isMediaPath(path)) {
      throw new ProjectArchiveError(
        `Media path "${item.path}" must be inside ${PROJECT_ARCHIVE_MEDIA_DIR}`,
      );
    }
    if (seen.has(path)) {
      throw new ProjectArchiveError(`Duplicate media path "${path}"`);
    }
    seen.add(path);
    entries.push({ path, blob: item.blob });
  }
  const stream = iteratorStream(tarChunks(entries)).pipeThrough(
    new CompressionStream("gzip"),
  );
  const blob = await new Response(stream).blob();
  return new Blob([blob], { type: "application/gzip" });
}

/* Reading */

// Pulls exact byte counts off a stream of arbitrarily sized chunks.
class ChunkReader {
  #reader: ReadableStreamDefaultReader<Bytes>;
  #chunk: Bytes = new Uint8Array(0);

  constructor(stream: ReadableStream<Bytes>) {
    this.#reader = stream.getReader();
  }

  // Returns chunks totaling `size` bytes, or fewer if the stream ends first.
  async readParts(size: number): Promise<Bytes[]> {
    const parts: Bytes[] = [];
    let remaining = size;
    while (remaining > 0) {
      if (this.#chunk.length === 0) {
        const { done, value } = await this.#reader.read();
        if (done) break;
        this.#chunk = value;
        continue;
      }
      const take = Math.min(remaining, this.#chunk.length);
      parts.push(this.#chunk.subarray(0, take));
      this.#chunk = this.#chunk.subarray(take);
      remaining -= take;
    }
    return parts;
  }

  async read(size: number): Promise<Bytes> {
    const parts = await this.readParts(size);
    if (parts.length === 1) return parts[0];
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }

  async skip(size: number) {
    const parts = await this.readParts(size);
    return parts.reduce((n, p) => n + p.length, 0);
  }

  async cancel() {
    await this.#reader.cancel().catch(() => {});
  }
}

function readString(block: Uint8Array, offset: number, size: number) {
  const field = block.subarray(offset, offset + size);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

function readOctal(block: Uint8Array, offset: number, size: number) {
  const text = readString(block, offset, size).trim();
  if (!/^[0-7]*$/.test(text)) return Number.NaN;
  return text === "" ? 0 : Number.parseInt(text, 8);
}

function validChecksum(block: Uint8Array) {
  const expected = readOctal(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  return sum === expected;
}

function parsePax(data: Uint8Array) {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const length = Number(decoder.decode(data.subarray(offset, space)));
    if (space === -1 || !Number.isInteger(length) || length <= 0) {
      throw new ProjectArchiveError(
        "Malformed project archive: bad PAX header",
      );
    }
    const record = decoder.decode(
      data.subarray(space + 1, offset + length - 1),
    );
    const equals = record.indexOf("=");
    if (equals > 0)
      records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

type TarEntry = { path: string; type: string; parts: Bytes[] };

// Yields each regular file and directory in the tar stream. `wantData`
// decides whether a file's contents are kept or skipped.
async function* tarEntries(
  reader: ChunkReader,
  wantData: (path: string) => boolean,
): AsyncGenerator<TarEntry> {
  let pax = new Map<string, string>();
  let longName: string | null = null;
  for (;;) {
    const block = await reader.read(BLOCK);
    if (block.length === 0) {
      throw new ProjectArchiveError(
        "Malformed project archive: missing end of archive",
      );
    }
    if (block.length < BLOCK) {
      throw new ProjectArchiveError(
        "Malformed project archive: truncated header",
      );
    }
    if (block.every((byte) => byte === 0)) return;
    if (!validChecksum(block)) {
      throw new ProjectArchiveError(
        "Malformed project archive: bad header checksum",
      );
    }
    const type = readString(block, 156, 1) || "0";
    const paxSize = pax.get("size");
    const size =
      paxSize !== undefined ? Number(paxSize) : readOctal(block, 124, 12);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new ProjectArchiveError(
        "Malformed project archive: bad entry size",
      );
    }
    const padded = Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x" || type === "L") {
      const data = await reader.read(size);
      if (data.length < size) {
        throw new ProjectArchiveError(
          "Malformed project archive: truncated entry",
        );
      }
      await reader.skip(padded - size);
      if (type === "x") pax = parsePax(data);
      else longName = readString(data, 0, data.length);
      continue;
    }
    if (type === "g") {
      await reader.skip(padded);
      continue;
    }

    // Only POSIX ustar headers carry a name prefix; old GNU headers store
    // other fields there.
    const isPosix = readString(block, 257, 6) === "ustar";
    const prefix = isPosix ? readString(block, 345, 155) : "";
    const ustarName = prefix
      ? `${prefix}/${readString(block, 0, 100)}`
      : readString(block, 0, 100);
    const rawPath = pax.get("path") ?? longName ?? ustarName;
    pax = new Map();
    longName = null;
    // Tools that archive a directory's contents write `./` for the root.
    if (type === "5" && /^(\.\/?)+$/.test(rawPath)) {
      await reader.skip(padded);
      continue;
    }
    const path = normalizeArchivePath(rawPath);
    if (!path) {
      throw new ProjectArchiveError(
        `Project archive entry "${rawPath}" is outside the archive root`,
      );
    }
    if (type !== "0" && type !== "5") {
      throw new ProjectArchiveError(
        `Project archive entry "${path}" is not a regular file`,
      );
    }
    if (type === "0" && wantData(path)) {
      const parts = await reader.readParts(size);
      if (parts.reduce((n, p) => n + p.length, 0) < size) {
        throw new ProjectArchiveError(
          "Malformed project archive: truncated entry",
        );
      }
      await reader.skip(padded - size);
      yield { path, type, parts };
    } else {
      if ((await reader.skip(padded)) < padded) {
        throw new ProjectArchiveError(
          "Malformed project archive: truncated entry",
        );
      }
      yield { path, type, parts: [] };
    }
  }
}

function gunzip(input: Uint8Array | Blob) {
  const blob = input instanceof Blob ? input : new Blob([input as Bytes]);
  return blob.stream().pipeThrough(new DecompressionStream("gzip"));
}

async function headBytes(input: Uint8Array | Blob) {
  return input instanceof Blob
    ? new Uint8Array(await input.slice(0, 2).arrayBuffer())
    : input;
}

function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export async function readProjectArchive(
  input: Uint8Array | Blob,
): Promise<ProjectArchive> {
  if (!isGzipBytes(await headBytes(input))) {
    throw new ProjectArchiveError(
      "Not a zvid project archive: the file is not gzip-compressed",
    );
  }
  const reader = new ChunkReader(gunzip(input));
  let project: LvpSession | undefined;
  const media: ProjectArchiveMedia[] = [];
  try {
    const wanted = (path: string) =>
      path === PROJECT_ARCHIVE_SESSION_PATH || isMediaPath(path);
    for await (const entry of tarEntries(reader, wanted)) {
      if (entry.type !== "0" || !wanted(entry.path)) continue;
      if (entry.path === PROJECT_ARCHIVE_SESSION_PATH) {
        const text = await new Blob(entry.parts).text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new ProjectArchiveError(
            "Project archive project.json is not valid JSON",
          );
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new ProjectArchiveError(
            "Project archive project.json is not a session object",
          );
        }
        project = parsed as LvpSession;
      } else {
        const file = new File(entry.parts, basename(entry.path));
        media.push({ path: entry.path, file });
      }
    }
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw error;
    throw new ProjectArchiveError(
      `Malformed project archive: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await reader.cancel();
  }
  if (!project) {
    throw new ProjectArchiveError("Project archive is missing project.json");
  }
  return { project, media };
}

// Both `.zvd` archives and Ableton `.als` sets start with the gzip magic.
// A project archive is a tar with `project.json` inside; a Live set is
// gzip-compressed XML, which never parses as a tar header.
export async function isProjectArchive(
  input: Uint8Array | Blob,
): Promise<boolean> {
  if (!isGzipBytes(await headBytes(input))) return false;
  const reader = new ChunkReader(gunzip(input));
  try {
    for await (const entry of tarEntries(reader, () => false)) {
      if (entry.type === "0" && entry.path === PROJECT_ARCHIVE_SESSION_PATH) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await reader.cancel();
  }
}
