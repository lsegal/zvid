// Serves /downloads/* from the DOWNLOADS R2 bucket (`r2_buckets` in
// wrangler.jsonc), so installer downloads stay same-origin. The DAW bundles
// workflow overwrites the ZVID Capture installers and their manifest there
// under fixed keys (`capture/...`); see README.md (Cloudflare Worker deploy).

export const DOWNLOADS_PATH_PREFIX = "/downloads/";

// The subset of the Workers `R2Range` this module uses.
export type DownloadRange = { offset: number; length: number };

// The subset of the Workers `R2Object`/`R2ObjectBody` this module uses.
export type DownloadObject = {
  size: number;
  etag: string;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
  body?: ReadableStream | null;
};

// The subset of the Workers `R2Bucket` binding this module uses.
export type DownloadsBucket = {
  head(key: string): Promise<DownloadObject | null>;
  get(
    key: string,
    options?: { range?: DownloadRange; onlyIf?: { etagMatches: string } },
  ): Promise<DownloadObject | null>;
};

export type DownloadsEnv = {
  DOWNLOADS?: DownloadsBucket;
};

export function isDownloadPath(pathname: string) {
  return pathname.startsWith(DOWNLOADS_PATH_PREFIX);
}

// The bucket key for a /downloads/* path, or null for one that can't name an
// object.
export function downloadKey(pathname: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(DOWNLOADS_PATH_PREFIX.length));
  } catch {
    return null;
  }
  return key === "" || key.endsWith("/") || key.split("/").includes("..")
    ? null
    : key;
}

// A single `bytes=` range of an object of `size` bytes. Null when there is no
// range to honor (none, several or malformed, which serve the whole object),
// "unsatisfiable" when it starts past the end.
export function parseRange(
  header: string | null,
  size: number,
): DownloadRange | "unsatisfiable" | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) {
    return null;
  }
  if (match[1] === "") {
    // `bytes=-500`: the last 500 bytes.
    const length = Math.min(Number(match[2]), size);
    return length > 0 ? { offset: size - length, length } : "unsatisfiable";
  }
  const start = Number(match[1]);
  if (start >= size) {
    return "unsatisfiable";
  }
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return end < start ? null : { offset: start, length: end - start + 1 };
}

function etagMatches(header: string | null, object: DownloadObject) {
  return (
    header !== null &&
    header.split(",").some((tag) => {
      const value = tag.trim().replace(/^W\//, "");
      return value === "*" || value === object.httpEtag;
    })
  );
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

export async function handleDownload(
  request: Request,
  env: DownloadsEnv,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }
  const key = downloadKey(new URL(request.url).pathname);
  const bucket = env.DOWNLOADS;
  if (!key || !bucket) {
    return notFound();
  }
  const object = await bucket.head(key);
  if (!object) {
    return notFound();
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  if (etagMatches(request.headers.get("If-None-Match"), object)) {
    return new Response(null, { status: 304, headers });
  }

  // A range only applies to the object the client already has part of.
  const ifRange = request.headers.get("If-Range");
  const range =
    ifRange === null || ifRange === object.httpEtag
      ? parseRange(request.headers.get("Range"), object.size)
      : null;
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Length", String(range ? range.length : object.size));
  if (range) {
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
  }
  const status = range ? 206 : 200;
  if (request.method === "HEAD") {
    return new Response(null, { status, headers });
  }

  // The etag check keeps the body the same object the headers describe, even
  // if a new installer overwrote it in between.
  const body = await bucket.get(key, {
    ...(range ? { range } : {}),
    onlyIf: { etagMatches: object.etag },
  });
  if (!body?.body) {
    return new Response("The download changed; try again", {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  }
  return new Response(body.body, { status, headers });
}
