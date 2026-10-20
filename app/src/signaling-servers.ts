// The public y-webrtc relay is the only built-in signaling server. zvid's own
// worker (../signaling) was the first default until its idle pings cost too
// much to keep running; it stays available to self-host. y-webrtc connects to
// every URL, and peers find each other through any one they share.
export const ZVID_SIGNALING_URL = "wss://zvid-signaling.lsegal.workers.dev";
export const PUBLIC_SIGNALING_URL = "wss://y-webrtc-eu.fly.dev";

export const BUILT_IN_SIGNALING_URLS = [PUBLIC_SIGNALING_URL];

// Earlier defaults, persisted as the user's setting; they move to the current
// default instead of pinning the user to an old server list.
const LEGACY_DEFAULT_SIGNALING_URLS = [
  [ZVID_SIGNALING_URL],
  [PUBLIC_SIGNALING_URL],
  [ZVID_SIGNALING_URL, PUBLIC_SIGNALING_URL],
];

export function splitSignalingUrls(value: string) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// The stored signaling setting to use, given the current default as fallback.
export function migrateLegacyStoredSignaling(
  value: string | undefined,
  fallback: string,
) {
  const urls = splitSignalingUrls(value ?? "");
  if (!urls.length) {
    return fallback;
  }

  const normalized = urls.join(", ");
  return LEGACY_DEFAULT_SIGNALING_URLS.some(
    (legacy) => legacy.join(", ") === normalized,
  )
    ? fallback
    : normalized;
}
