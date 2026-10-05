// Loads a sample project's media into the media cache while the sample is
// open, reporting each asset's progress so its clips show the same skeleton
// as media syncing from a peer: every asset is either already cached or
// downloaded from its same-origin URL and checked against the manifest's
// hash. Cached assets are reused without a download, so a warm cache opens
// offline; an evicted asset is downloaded again the next time it is needed.

import type { ProjectSession, SessionOpenResponse } from "../session.ts";
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

// What happens to each asset, in order: `queued` once it was not in the
// cache, `receiving` as its bytes arrive, then `ready` with its bytes or
// `failed`. A cached asset goes straight to `ready`.
export type SampleAssetEvent =
  | { asset: SampleAsset; phase: "queued" }
  | { asset: SampleAsset; phase: "receiving"; received: number; total: number }
  | { asset: SampleAsset; phase: "ready"; blob: Blob; downloaded: boolean }
  | { asset: SampleAsset; phase: "failed"; error: Error };

// Sample assets downloaded at once, like peer transfers.
export const MAX_SAMPLE_DOWNLOADS = 2;

export class SampleLoadCanceledError extends Error {
  constructor() {
    super("Loading the sample was canceled.");
    this.name = "SampleLoadCanceledError";
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new SampleLoadCanceledError();
  }
}

// Downloads `asset`, reporting bytes read so far, and checks its size and
// hash. Throws when the download fails, is canceled or has other bytes.
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

// A cached copy of `asset`, when it still has the manifest's size and hash.
// A copy that was emptied or damaged in the cache is downloaded again.
async function readCachedAsset(asset: SampleAsset, deps: SampleLoadDeps) {
  try {
    const blob = await deps.getCached(asset.id);
    return blob &&
      blob.size === asset.bytes &&
      (await deps.digest(blob)) === asset.sha256
      ? blob
      : undefined;
  } catch {
    return undefined;
  }
}

// Makes sure every one of `assets` is cached, reporting each one through
// `onAsset`: cached assets are ready at once, and the rest are downloaded
// at most `concurrency` at a time. A failed asset doesn't stop the others,
// and assets cached before a failure or cancel stay cached, so a retry only
// downloads the rest. Rejects with SampleLoadCanceledError when `signal`
// aborts, without reporting the assets it stopped.
export async function loadSampleAssets(
  assets: readonly SampleAsset[],
  deps: SampleLoadDeps,
  options: {
    signal?: AbortSignal;
    concurrency?: number;
    onAsset?: (event: SampleAssetEvent) => void;
  } = {},
) {
  const { signal, onAsset } = options;
  const concurrency = Math.max(1, options.concurrency ?? MAX_SAMPLE_DOWNLOADS);
  const report = (event: SampleAssetEvent) => {
    if (!signal?.aborted) {
      onAsset?.(event);
    }
  };

  const pending: SampleAsset[] = [];
  for (const asset of assets) {
    throwIfAborted(signal);
    const blob = await readCachedAsset(asset, deps);
    if (blob) {
      report({ asset, phase: "ready", blob, downloaded: false });
    } else {
      pending.push(asset);
    }
  }
  throwIfAborted(signal);
  for (const asset of pending) {
    report({ asset, phase: "queued" });
  }

  let downloaded = 0;
  const failed: SampleAsset[] = [];
  const next = pending.values();
  const worker = async () => {
    for (const asset of next) {
      throwIfAborted(signal);
      report({ asset, phase: "receiving", received: 0, total: asset.bytes });
      try {
        const blob = await downloadSampleAsset(asset, deps, {
          signal,
          onBytes: (received) =>
            report({ asset, phase: "receiving", received, total: asset.bytes }),
        });
        throwIfAborted(signal);
        await deps.cache(asset.id, blob);
        downloaded += 1;
        report({ asset, phase: "ready", blob, downloaded: true });
      } catch (error) {
        throwIfAborted(signal);
        failed.push(asset);
        report({
          asset,
          phase: "failed",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );
  throwIfAborted(signal);
  return { downloaded, failed };
}

// What opening the sample applies: the template session, with every asset
// as a missing ref under its stable id so the cache, or a download, supplies
// it.
export function buildSampleOpenPayload(
  manifest: SampleManifest,
  sessionText: string,
): SessionOpenResponse {
  const session = JSON.parse(sessionText) as ProjectSession;
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

export async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
