// zvid's own signaling worker (../signaling) first, with the public y-webrtc
// relay as a fallback. y-webrtc connects to every URL, and peers find each
// other through any one they share.
export const ZVID_SIGNALING_URL = "wss://zvid-signaling.lsegal.workers.dev";
export const PUBLIC_SIGNALING_URL = "wss://y-webrtc-eu.fly.dev";
