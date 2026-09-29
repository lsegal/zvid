// Builds and reads collaboration invite links. The link always points at the
// app's own origin (or a configured public URL), and the room password travels
// in the URL fragment so it is never sent to servers or proxies.

export type ShareLinkLocation = {
  origin: string;
  pathname: string;
  // Public URL the app is reached under, e.g. `VITE_PUBLIC_APP_URL`. Wins over
  // the page origin when set.
  publicAppUrl?: string;
};

export type ShareLink = {
  url: string;
  // True when the link points at a loopback or private-network host, so it
  // only works on this machine or network.
  localOnly: boolean;
};

export type InviteParams = {
  room: string;
  signal: string;
  password: string;
};

const PASSWORD_PARAM = "password";

export function isLocalHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return true;
  }

  return (
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

function parsePublicAppUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

export function buildPublicShareUrl(
  roomName: string,
  signalingUrls: string[],
  password: string,
  location: ShareLinkLocation,
): ShareLink {
  const publicAppUrl = parsePublicAppUrl(location.publicAppUrl);
  const shareUrl = publicAppUrl
    ? new URL(publicAppUrl.pathname, publicAppUrl.origin)
    : new URL(location.pathname, location.origin);

  shareUrl.searchParams.set("room", roomName);
  shareUrl.searchParams.set("signal", signalingUrls.join(","));

  const trimmedPassword = password.trim();
  if (trimmedPassword) {
    const fragment = new URLSearchParams();
    fragment.set(PASSWORD_PARAM, trimmedPassword);
    shareUrl.hash = fragment.toString();
  }

  return {
    url: shareUrl.toString(),
    localOnly: !publicAppUrl && isLocalHostname(shareUrl.hostname),
  };
}

function splitInvite(value: string) {
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : value.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf("?");
  const query =
    queryIndex === -1 ? beforeHash : beforeHash.slice(queryIndex + 1);
  return {
    query: new URLSearchParams(query),
    hash: new URLSearchParams(hash),
  };
}

// Reads the invite parameters from a share URL or a bare query string. The
// password is read from the fragment first, falling back to the query for
// links shared before it moved.
export function parseInviteParams(value: string): InviteParams {
  let query: URLSearchParams;
  let hash: URLSearchParams;
  try {
    const url = new URL(value);
    query = url.searchParams;
    hash = new URLSearchParams(url.hash.slice(1));
  } catch {
    ({ query, hash } = splitInvite(value));
  }

  return {
    room: query.get("room")?.trim() ?? "",
    signal: query.get("signal")?.trim() ?? "",
    password:
      hash.get(PASSWORD_PARAM)?.trim() ||
      query.get(PASSWORD_PARAM)?.trim() ||
      "",
  };
}

// Returns `href` without the password in its fragment or query, or null when
// it carries none, so the address bar can be scrubbed after reading it.
export function removeInvitePassword(href: string) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (!hash.has(PASSWORD_PARAM) && !url.searchParams.has(PASSWORD_PARAM)) {
    return null;
  }

  hash.delete(PASSWORD_PARAM);
  url.searchParams.delete(PASSWORD_PARAM);
  url.hash = hash.toString();
  return url.toString();
}
