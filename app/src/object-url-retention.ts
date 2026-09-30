// Keeps blob URLs readable while something still reads them. A running
// export renders from a snapshot of the session, so replacing or removing
// media in the editor meanwhile must not revoke the URLs that snapshot uses:
// a revoke of a retained URL waits until the last holder releases it.
const holds = new Map<string, number>();
const pendingRevokes = new Set<string>();

// Retains `urls` until the returned release is called (once).
export function retainObjectUrls(urls: Iterable<string | undefined>) {
  const retained = [...new Set(urls)].filter(
    (url): url is string => typeof url === "string" && url.startsWith("blob:"),
  );
  for (const url of retained) {
    holds.set(url, (holds.get(url) ?? 0) + 1);
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    for (const url of retained) {
      const count = (holds.get(url) ?? 1) - 1;
      if (count > 0) {
        holds.set(url, count);
        continue;
      }
      holds.delete(url);
      if (pendingRevokes.delete(url)) {
        URL.revokeObjectURL(url);
      }
    }
  };
}

// URL.revokeObjectURL, deferred while the URL is retained.
export function revokeObjectUrl(url: string) {
  if (holds.has(url)) {
    pendingRevokes.add(url);
    return;
  }
  URL.revokeObjectURL(url);
}
