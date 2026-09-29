// Connection diagnostics for collaboration sessions: ICE server config, the
// connection summary shown in the header, and the rows of the diagnostics
// dialog. Plain data so both can be tested without a browser.

export type CollaborationRole = "host" | "guest";

export type SignalingStatus = {
  url: string;
  connected: boolean;
};

export type CollaborationDiagnostics = {
  signaling: SignalingStatus[];
  // No signaling server connected within the grace period.
  signalingTimedOut: boolean;
  // WebRTC peers discovered through signaling, connected or not.
  peersFound: number;
  // WebRTC peers whose data channel is open.
  peersConnected: number;
  // Discovered peers that never connected within the grace period.
  peersStalled: number;
  // Tabs of this same browser profile, synced over BroadcastChannel. They
  // connect even when signaling and WebRTC are broken, so they are counted
  // apart from real peers.
  sameBrowserPeers: number;
  // The project state has been received (guest) or published (host).
  synced: boolean;
  // A guest found no host within the grace period.
  hostTimedOut: boolean;
  lastError: string | null;
};

export type CollaborationTone =
  | "idle"
  | "pending"
  | "waiting"
  | "live"
  | "error";

export const EMPTY_COLLABORATION_DIAGNOSTICS: CollaborationDiagnostics = {
  signaling: [],
  signalingTimedOut: false,
  peersFound: 0,
  peersConnected: 0,
  peersStalled: 0,
  sameBrowserPeers: 0,
  synced: false,
  hostTimedOut: false,
  lastError: null,
};

// simple-peer's own defaults. Without TURN, peers behind symmetric NAT, CGNAT
// or strict firewalls cannot connect.
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"],
  },
];

export const PEER_UNREACHABLE_MESSAGE =
  "Can't reach peers, check network (TURN may be required)";

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { urls, username, credential } = value as Record<string, unknown>;
  const validUrls =
    (typeof urls === "string" && urls.trim() !== "") ||
    (Array.isArray(urls) &&
      urls.length > 0 &&
      urls.every((url) => typeof url === "string" && url.trim() !== ""));
  return (
    validUrls &&
    (username === undefined || typeof username === "string") &&
    (credential === undefined || typeof credential === "string")
  );
}

/**
 * Parses `VITE_ICE_SERVERS`: a JSON array of RTCIceServer objects, or a single
 * object. Returns the STUN defaults when unset, and throws when it is set but
 * invalid so a broken TURN config is not silently ignored.
 */
export function parseIceServers(value: string | undefined): RTCIceServer[] {
  const raw = value?.trim();
  if (!raw) {
    return DEFAULT_ICE_SERVERS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("VITE_ICE_SERVERS is not valid JSON.");
  }

  const servers = Array.isArray(parsed) ? parsed : [parsed];
  if (servers.length === 0 || !servers.every(isIceServer)) {
    throw new Error(
      'VITE_ICE_SERVERS must be a JSON array of { "urls": ..., "username"?, "credential"? } objects.',
    );
  }
  return servers;
}

export function hasTurnServer(servers: RTCIceServer[]) {
  return servers.some((server) =>
    (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
      /^turns?:/i.test(url),
    ),
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The short label and tone shown in the header status pill. */
export function summarizeCollaboration(
  role: CollaborationRole,
  diagnostics: CollaborationDiagnostics,
): { label: string; tone: CollaborationTone } {
  const connectedPeers =
    diagnostics.peersConnected + diagnostics.sameBrowserPeers;

  if (connectedPeers > 0) {
    if (role === "guest" && !diagnostics.synced) {
      return { label: "Connected, syncing project...", tone: "pending" };
    }
    return {
      label: `${plural(connectedPeers, "peer", "peers")} connected`,
      tone: "live",
    };
  }

  if (diagnostics.peersFound > 0) {
    return diagnostics.peersStalled >= diagnostics.peersFound
      ? { label: PEER_UNREACHABLE_MESSAGE, tone: "error" }
      : { label: "Connecting to peer...", tone: "pending" };
  }

  if (!diagnostics.signaling.some((entry) => entry.connected)) {
    if (diagnostics.signalingTimedOut) {
      return { label: "Can't reach the signaling server", tone: "error" };
    }
    return {
      label: role === "host" ? "Opening share..." : "Connecting to share...",
      tone: "pending",
    };
  }

  if (role === "host") {
    return { label: "Sharing, waiting for peer", tone: "waiting" };
  }

  if (diagnostics.hostTimedOut) {
    return {
      label: "Host not found, check the invite and that the host is sharing",
      tone: "error",
    };
  }
  return { label: "Waiting for host...", tone: "waiting" };
}

export type DiagnosticsRow = {
  label: string;
  value: string;
  tone?: "ok" | "error";
};

/** The rows of the connection diagnostics dialog. */
export function buildDiagnosticsRows(
  role: CollaborationRole,
  diagnostics: CollaborationDiagnostics,
  iceServers: RTCIceServer[],
): DiagnosticsRow[] {
  const rows: DiagnosticsRow[] = diagnostics.signaling.map((entry) => ({
    label: `Signaling ${entry.url}`,
    value: entry.connected
      ? "Connected"
      : diagnostics.signalingTimedOut
        ? "Unreachable"
        : "Connecting...",
    tone: entry.connected
      ? "ok"
      : diagnostics.signalingTimedOut
        ? "error"
        : undefined,
  }));

  rows.push(
    { label: "Peers found", value: String(diagnostics.peersFound) },
    {
      label: "Peers connected (WebRTC)",
      value: String(diagnostics.peersConnected),
      tone:
        diagnostics.peersConnected > 0
          ? "ok"
          : diagnostics.peersStalled > 0
            ? "error"
            : undefined,
    },
  );

  if (diagnostics.sameBrowserPeers > 0) {
    rows.push({
      label: "Same-browser tabs",
      value: `${diagnostics.sameBrowserPeers} (synced without WebRTC)`,
    });
  }

  rows.push(
    {
      label: "Project state",
      value: diagnostics.synced
        ? role === "host"
          ? "Published"
          : "Received from host"
        : role === "host"
          ? "Publishing..."
          : "Waiting for host",
      tone: diagnostics.synced ? "ok" : undefined,
    },
    {
      label: "Relay (TURN)",
      value: hasTurnServer(iceServers)
        ? "Configured"
        : "Not configured, STUN only",
    },
    {
      label: "Last error",
      value: diagnostics.lastError ?? "None",
      tone: diagnostics.lastError ? "error" : undefined,
    },
  );

  return rows;
}
