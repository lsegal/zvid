// Browser storage bookkeeping for cached media: persistence, quota estimates,
// least-recently-used eviction and `QuotaExceededError` handling. Everything
// takes its storage and cache access as arguments so it can be tested without
// a browser.

export type StoragePersistence = "persistent" | "best-effort" | "unsupported";

export type StorageEstimate = { usage: number; quota: number };

export type StorageLike = {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
};

// One cached media file, as tracked for eviction and the storage UI.
export type CachedMediaRecord = {
  id: string;
  size: number;
  lastUsedAt: number;
  // Sessions that referenced the file, oldest first.
  sessions: string[];
};

export type CacheWriteResult =
  | { status: "cached" }
  | { status: "skipped"; reason: "quota" };

// Kept free on top of the file itself so a write that only just fits doesn't
// leave the origin at its quota.
export const QUOTA_HEADROOM_BYTES = 16 * 1024 * 1024;

export function getBrowserStorage(): StorageLike | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.storage;
}

// Reports the current persistence state without asking the browser for
// persistence, so it's safe to call on page load.
export async function getPersistence(
  storage: StorageLike | undefined = getBrowserStorage(),
): Promise<StoragePersistence> {
  if (!storage?.persisted) {
    return "unsupported";
  }
  try {
    return (await storage.persisted()) ? "persistent" : "best-effort";
  } catch {
    return "best-effort";
  }
}

// Asks the browser to exempt this origin from eviction under storage
// pressure. Some browsers prompt, so call it only once the user has loaded or
// imported media.
export async function requestPersistence(
  storage: StorageLike | undefined = getBrowserStorage(),
): Promise<StoragePersistence> {
  if (!storage?.persist) {
    return "unsupported";
  }
  try {
    if (await storage.persisted?.()) {
      return "persistent";
    }
    return (await storage.persist()) ? "persistent" : "best-effort";
  } catch {
    return "best-effort";
  }
}

export async function estimateStorage(
  storage: StorageLike | undefined = getBrowserStorage(),
): Promise<StorageEstimate | null> {
  if (!storage?.estimate) {
    return null;
  }
  try {
    const { usage, quota } = await storage.estimate();
    if (typeof quota !== "number" || !Number.isFinite(quota) || quota <= 0) {
      return null;
    }
    return { usage: usage ?? 0, quota };
  } catch {
    return null;
  }
}

export function isQuotaExceededError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}

// Picks the least recently used files, never ones the current session
// references, until `bytesNeeded` fits in `bytesAvailable`. Returns the ids to
// evict (empty when it already fits), or null when evicting everything
// eligible still wouldn't make room.
export function planEviction(
  records: readonly CachedMediaRecord[],
  bytesNeeded: number,
  bytesAvailable: number,
  referencedIds: ReadonlySet<string>,
  excludeId?: string,
): string[] | null {
  if (bytesNeeded <= bytesAvailable) {
    return [];
  }

  const candidates = records
    .filter(
      (record) => record.id !== excludeId && !referencedIds.has(record.id),
    )
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const evicted: string[] = [];
  let available = bytesAvailable;
  for (const record of candidates) {
    evicted.push(record.id);
    available += record.size;
    if (bytesNeeded <= available) {
      return evicted;
    }
  }
  return null;
}

export type WriteWithinQuotaOptions = {
  id: string;
  size: number;
  referencedIds: ReadonlySet<string>;
  estimate: () => Promise<StorageEstimate | null>;
  listRecords: () => Promise<CachedMediaRecord[]>;
  evict: (ids: string[]) => Promise<void>;
  write: () => Promise<void>;
};

// Writes a file into the cache, first evicting old unreferenced files when the
// estimate says it won't fit. A `QuotaExceededError` from the write gets the
// same treatment once; if it still doesn't fit, the file is skipped rather
// than failing the caller.
export async function writeWithinQuota({
  id,
  size,
  referencedIds,
  estimate,
  listRecords,
  evict,
  write,
}: WriteWithinQuotaOptions): Promise<CacheWriteResult> {
  const current = await estimate();
  if (current) {
    const records = await listRecords();
    // Replacing an entry frees its old bytes.
    const replaced = records.find((record) => record.id === id)?.size ?? 0;
    const available =
      current.quota - current.usage - QUOTA_HEADROOM_BYTES + replaced;
    const plan = planEviction(records, size, available, referencedIds, id);
    if (!plan) {
      return { status: "skipped", reason: "quota" };
    }
    if (plan.length) {
      await evict(plan);
    }
  }

  try {
    await write();
    return { status: "cached" };
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }
  }

  const plan = planEviction(await listRecords(), size, 0, referencedIds, id);
  if (!plan?.length) {
    return { status: "skipped", reason: "quota" };
  }
  await evict(plan);
  try {
    await write();
    return { status: "cached" };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return { status: "skipped", reason: "quota" };
    }
    throw error;
  }
}

export type SessionUsage = {
  session: string;
  bytes: number;
  count: number;
  current: boolean;
};

// Groups cached bytes by session for the storage UI. A file counts toward the
// current session when that session references it, otherwise toward the last
// session that did; files cached before sessions were tracked fall under
// `unknownSession`.
export function summarizeSessionUsage(
  records: readonly CachedMediaRecord[],
  currentSession: string,
  referencedIds: ReadonlySet<string>,
  unknownSession = "Earlier sessions",
): SessionUsage[] {
  const bySession = new Map<string, SessionUsage>();
  for (const record of records) {
    const session = referencedIds.has(record.id)
      ? currentSession
      : (record.sessions.at(-1) ?? unknownSession);
    const usage = bySession.get(session) ?? {
      session,
      bytes: 0,
      count: 0,
      current: session === currentSession,
    };
    usage.bytes += record.size;
    usage.count += 1;
    bySession.set(session, usage);
  }
  return [...bySession.values()].sort(
    (a, b) => Number(b.current) - Number(a.current) || b.bytes - a.bytes,
  );
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

// `1536` -> `1.5 KB`, `5e9` -> `4.7 GB`.
export function formatBytes(bytes: number) {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}
