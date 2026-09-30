// Loads a sample project's media into the media cache before the sample is
// opened, so opening it never commits a half-loaded project: every asset is
// either already cached or downloaded from its same-origin URL and checked
// against the manifest's hash first. Cached assets are reused without a
// download, so a warm cache opens offline; an evicted asset is downloaded
// again the next time it is needed.

import type { LvpSession, SessionOpenResponse } from "../session.ts";
import type { SampleAsset, SampleManifest } from "./sample-manifest.ts";

export type SampleLoadDeps = {
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  getCached: (id: string) => Promise<Blob | null | undefined>;
  // Stores a downloaded asset. A cache that is full may drop it; the asset
  // is then downloaded again when the project needs it.
  cache: (id: string, blob: Blob) => Promise<unknown>;
  // Hex SHA-256 of `blob`.
  digest: (blob: Blob) => Promise<string>;
};

export type SampleLoadProgress = {
  loadedBytes: number;
  totalBytes: number;
  completedAssets: number;
  totalAssets: number;
  // The asset being downloaded, if any.
  current?: string;
};

export class SampleLoadCancelledError extends Error {
  constructor() {
    super("Loading the sample was cancelled.");
    this.name = "SampleLoadCancelledError";
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new SampleLoadCancelledError();
  }
}

// Downloads `asset`, reporting bytes read so far, and checks its size and
// hash. Throws when the download fails, is cancelled or has other bytes.
export async function downloadSampleAsset(
  asset: SampleAsset,
  deps: Pick<SampleLoadDeps, "fetch" | "digest">,
  options: { signal?: AbortSignal; onBytes?: (bytes: number) => void } = {},
): Promise<Blob> {
  const { signal, onBytes } = options;
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await deps.fetch(asset.url, { signal });
  } catch (error) {
    throwIfAborted(signal);
    throw new Error(
      `Could not download ${asset.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Could not download ${asset.name}: ${response.status}`);
  }

  const chunks: BlobPart[] = [];
  let received = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
        received += value.byteLength;
        onBytes?.(received);
      }
    } catch (error) {
      throwIfAborted(signal);
      throw new Error(
        `Could not download ${asset.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    const blob = await response.blob();
    chunks.push(blob);
    received = blob.size;
    onBytes?.(received);
  }
  throwIfAborted(signal);

  const blob = new Blob(chunks, { type: asset.mediaType });
  if (blob.size !== asset.bytes || (await deps.digest(blob)) !== asset.sha256) {
    throw new Error(
      `${asset.name} did not match the sample manifest; it may be out of date.`,
    );
  }
  return blob;
}

// A cached copy of `asset`, when it has the manifest's size. The hash was
// checked when it was downloaded.
async function readCachedAsset(asset: SampleAsset, deps: SampleLoadDeps) {
  try {
    const blob = await deps.getCached(asset.id);
    return blob && blob.size === asset.bytes ? blob : undefined;
  } catch {
    return undefined;
  }
}

// Makes sure every asset of `manifest` is cached, downloading the ones that
// aren't. Rejects with SampleLoadCancelledError when `signal` aborts, and
// with the first failure otherwise; assets cached before either stay cached,
// so a retry only downloads the rest.
export async function loadSampleAssets(
  manifest: SampleManifest,
  deps: SampleLoadDeps,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: SampleLoadProgress) => void;
  } = {},
) {
  const { signal, onProgress } = options;
  const totalBytes = manifest.assets.reduce(
    (total, asset) => total + asset.bytes,
    0,
  );
  const progress: SampleLoadProgress = {
    loadedBytes: 0,
    totalBytes,
    completedAssets: 0,
    totalAssets: manifest.assets.length,
  };
  const report = (patch: Partial<SampleLoadProgress>) => {
    Object.assign(progress, patch);
    onProgress?.({ ...progress });
  };
  report({});

  let downloaded = 0;
  for (const asset of manifest.assets) {
    throwIfAborted(signal);
    const done = progress.loadedBytes;
    if (!(await readCachedAsset(asset, deps))) {
      report({ current: asset.name });
      const blob = await downloadSampleAsset(asset, deps, {
        signal,
        onBytes: (bytes) => report({ loadedBytes: done + bytes }),
      });
      throwIfAborted(signal);
      await deps.cache(asset.id, blob);
      downloaded += 1;
    }
    report({
      loadedBytes: done + asset.bytes,
      completedAssets: progress.completedAssets + 1,
      current: undefined,
    });
  }
  return { downloaded };
}

// What opening the sample applies, once its assets are cached: the template
// session, with every asset as a missing ref under its stable id so the
// cache supplies it.
export function buildSampleOpenPayload(
  manifest: SampleManifest,
  sessionText: string,
): SessionOpenResponse {
  const session = JSON.parse(sessionText) as LvpSession;
  return {
    sessionName: manifest.sessionName,
    session,
    mediaRefs: manifest.assets.map((asset) => ({
      id: asset.id,
      path: asset.path,
      name: asset.name,
      url: "",
      exists: false,
    })),
  };
}

// Whether the app opens the sample on its own at startup: only for the
// owner of the workspace, when nothing was restored (a saved session that
// couldn't be read is kept for the user instead). `?sample=0` turns it off
// and `?sample=1` on; otherwise it is off under automation (the browser
// tests start from an empty editor).
export function shouldAutoOpenSample(options: {
  access: string;
  restored: boolean;
  corrupt: boolean;
  search: string;
  webdriver: boolean;
}) {
  if (options.access !== "owner" || options.restored || options.corrupt) {
    return false;
  }
  const flag = new URLSearchParams(options.search).get("sample");
  if (flag === "0" || flag === "1") {
    return flag === "1";
  }
  return !options.webdriver;
}

export function formatSampleProgress(progress: SampleLoadProgress) {
  const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
  return `${megabytes(progress.loadedBytes)} of ${megabytes(progress.totalBytes)} MB`;
}

export async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
