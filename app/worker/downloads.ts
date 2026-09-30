// Serves the ZVID Capture installers under /downloads from R2. They are too
// large for Worker static assets (25 MiB each), so
// scripts/fetch-capture-installers.ts uploads them to the bucket under the
// same key as their URL path, and only the small manifest ships in dist.

import {
  CAPTURE_INSTALLERS_DIR,
  CAPTURE_INSTALLERS_MANIFEST_URL,
} from "../src/capture-installers.ts";

const DOWNLOADS_PREFIX = `/${CAPTURE_INSTALLERS_DIR}/`;

export type DownloadsEnv = {
  CAPTURE_INSTALLERS: R2Bucket;
};

// The R2 key for an installer URL path, or null for paths the static assets
// serve (the manifest and anything outside /downloads).
export function downloadKey(pathname: string): string | null {
  if (
    !pathname.startsWith(DOWNLOADS_PREFIX) ||
    pathname === CAPTURE_INSTALLERS_MANIFEST_URL
  ) {
    return null;
  }
  let file: string;
  try {
    file = decodeURIComponent(pathname.slice(DOWNLOADS_PREFIX.length));
  } catch {
    return null;
  }
  return file === "" || file.includes("/")
    ? null
    : `${CAPTURE_INSTALLERS_DIR}/${file}`;
}

function objectHeaders(object: R2Object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set(
    "Content-Disposition",
    `attachment; filename="${object.key.slice(object.key.lastIndexOf("/") + 1)}"`,
  );
  return headers;
}

// The byte range R2 returned for a ranged get, as `[start, end]` inclusive.
function servedRange(object: R2Object): [number, number] | null {
  const range = object.range;
  if (!range) {
    return null;
  }
  if ("suffix" in range) {
    return [object.size - range.suffix, object.size - 1];
  }
  const start = range.offset ?? 0;
  const length = range.length ?? object.size - start;
  return [start, start + length - 1];
}

export async function handleDownload(
  request: Request,
  env: DownloadsEnv,
  key: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  if (request.method === "HEAD") {
    const object = await env.CAPTURE_INSTALLERS.head(key);
    if (!object) {
      return new Response(null, { status: 404 });
    }
    const headers = objectHeaders(object);
    headers.set("Content-Length", String(object.size));
    return new Response(null, { headers });
  }

  const object = await env.CAPTURE_INSTALLERS.get(key, {
    onlyIf: request.headers,
    range: request.headers.has("Range") ? request.headers : undefined,
  });
  if (!object) {
    return new Response("Not Found", { status: 404 });
  }
  const headers = objectHeaders(object);
  // A failed If-None-Match / If-Match precondition returns the object
  // without a body.
  if (!("body" in object)) {
    return new Response(null, {
      status: request.headers.has("If-None-Match") ? 304 : 412,
      headers,
    });
  }
  const range = request.headers.has("Range") ? servedRange(object) : null;
  if (range) {
    headers.set("Content-Range", `bytes ${range[0]}-${range[1]}/${object.size}`);
    headers.set("Content-Length", String(range[1] - range[0] + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
