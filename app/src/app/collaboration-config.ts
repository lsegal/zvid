import { isTauri } from "@tauri-apps/api/core";
import type { CollaborationConnectionState } from "../collaboration.ts";
import {
  buildDiagnosticsRows,
  type CollaborationRole,
  type CollaborationTone,
  EMPTY_COLLABORATION_DIAGNOSTICS,
  parseIceServers,
  summarizeCollaboration,
} from "../collaboration-diagnostics.ts";
import { loadIceServers, resolveRelayIceServersUrl } from "../ice-servers.ts";
import {
  type InviteParams,
  parseInviteParams,
  removeInvitePassword,
} from "../share-invite.ts";
import {
  PUBLIC_SIGNALING_URL,
  ZVID_SIGNALING_URL,
} from "../signaling-servers.ts";
import {
  COLLAB_STORAGE_KEY,
  JOINED_ROOM_STORAGE_KEY,
  PALETTE,
} from "./constants.ts";
import type { CollaborationMode, CollaborationRemoteCursor } from "./types.ts";
import { logClient, pickRandom } from "./util.ts";

const DEFAULT_SIGNALING_URLS = splitSignalingUrls(
  import.meta.env.VITE_SIGNALING_URL ||
    [ZVID_SIGNALING_URL, PUBLIC_SIGNALING_URL].join(","),
);

// Earlier defaults, persisted as the user's setting; they move to the current
// default instead of pinning the user to a single relay.
const LEGACY_DEFAULT_SIGNALING_URLS = [
  [ZVID_SIGNALING_URL],
  [PUBLIC_SIGNALING_URL],
];

export const ICE_SERVERS = resolveIceServers();

// The app worker's short-lived TURN credentials (worker/turn.ts).
const RELAY_ICE_SERVERS_URL = resolveRelayIceServersUrl(
  import.meta.env.VITE_ICE_SERVERS_URL,
  // The Vite dev server has no Worker to answer /api/ice-servers.
  import.meta.env.DEV ? undefined : globalThis.location?.origin,
  isTauri(),
);

// Relay credentials last a day; reuse them for an hour so reconnecting or
// renaming yourself doesn't mint new ones every time.
const RELAY_ICE_SERVERS_REUSE_MS = 60 * 60 * 1000;

export const IDLE_COLLABORATION_STATE: CollaborationConnectionState = {
  connected: false,
  peerCount: 0,
  mediaPeerCount: 0,
  collaborators: [],
  diagnostics: EMPTY_COLLABORATION_DIAGNOSTICS,
};

const COLLAB_NAME_PREFIXES = [
  "Neon",
  "Velvet",
  "Signal",
  "Tempo",
  "Quartz",
  "Echo",
  "Prism",
  "Static",
];

const COLLAB_NAME_SUFFIXES = [
  "Fox",
  "Tape",
  "Wave",
  "Frame",
  "Orbit",
  "Pulse",
  "Cut",
  "Vector",
];

function splitSignalingUrls(value: string) {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseSignalingUrls(value: string) {
  const urls = splitSignalingUrls(value);
  return urls.length ? urls : DEFAULT_SIGNALING_URLS;
}

function migrateLegacyStoredSignaling(
  value: string | undefined,
  fallback: string,
) {
  if (!value) {
    return fallback;
  }

  const normalized = parseSignalingUrls(value).join(", ");
  return LEGACY_DEFAULT_SIGNALING_URLS.some(
    (legacy) => legacy.join(", ") === normalized,
  )
    ? fallback
    : normalized;
}

function resolveIceServers() {
  try {
    return parseIceServers(import.meta.env.VITE_ICE_SERVERS);
  } catch (error) {
    console.error(
      `[zvid] collaboration:ice:config:error ${error instanceof Error ? error.message : String(error)}`,
    );
    return parseIceServers(undefined);
  }
}

let sessionIceServers: {
  promise: Promise<RTCIceServer[]>;
  fetchedAt: number;
} | null = null;

// The configured ICE servers plus the relay's TURN servers, fetched before a
// collaboration session starts.
export function getSessionIceServers() {
  if (
    !sessionIceServers ||
    Date.now() - sessionIceServers.fetchedAt > RELAY_ICE_SERVERS_REUSE_MS
  ) {
    const promise = loadIceServers(ICE_SERVERS, RELAY_ICE_SERVERS_URL, {
      log: logClient,
    });
    sessionIceServers = { promise, fetchedAt: Date.now() };
    // Without a relay, try again for the next session.
    void promise.then((servers) => {
      if (servers === ICE_SERVERS && sessionIceServers?.promise === promise) {
        sessionIceServers = null;
      }
    });
  }
  return sessionIceServers.promise;
}

function buildCollaboratorName() {
  const prefix = pickRandom(COLLAB_NAME_PREFIXES) ?? "Signal";
  const suffix = pickRandom(COLLAB_NAME_SUFFIXES) ?? "Wave";
  return `${prefix} ${suffix}`;
}

let pageInvite: InviteParams | null = null;

export function rememberJoinedRoom(room: string, password: string) {
  try {
    window.sessionStorage.setItem(
      JOINED_ROOM_STORAGE_KEY,
      JSON.stringify({ room, password }),
    );
  } catch {
    // Without session storage a refresh rejoins without the password.
  }
}

export function forgetJoinedRoom() {
  try {
    window.sessionStorage.removeItem(JOINED_ROOM_STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
}

// Fills in the password of a room this tab joined before a refresh, since
// the address bar only keeps the room and signaling servers.
function withRememberedPassword(invite: InviteParams): InviteParams {
  if (!invite.room) {
    return invite;
  }
  if (invite.password) {
    rememberJoinedRoom(invite.room, invite.password);
    return invite;
  }
  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(JOINED_ROOM_STORAGE_KEY) ?? "null",
    ) as { room?: string; password?: string } | null;
    return stored?.room === invite.room && stored.password
      ? { ...invite, password: stored.password }
      : invite;
  } catch {
    return invite;
  }
}

// Reads the invite from the page URL once, then scrubs the password from the
// address bar and history. Cached so StrictMode's repeated state initializers
// still see the password after the URL has been cleaned.
export function readPageInvite() {
  if (!pageInvite) {
    pageInvite = withRememberedPassword(
      parseInviteParams(window.location.href),
    );
    const scrubbedHref = removeInvitePassword(window.location.href);
    if (scrubbedHref) {
      window.history.replaceState(window.history.state, "", scrubbedHref);
    }
  }
  return pageInvite;
}

export function getInitialCollaborationConfig() {
  const defaults = {
    room: "",
    password: "",
    signaling: DEFAULT_SIGNALING_URLS.join(", "),
    name: buildCollaboratorName(),
    color: pickRandom(PALETTE)?.accent ?? "#7ca1ff",
    autoConnect: false,
  };

  if (typeof window === "undefined") {
    return defaults;
  }

  let stored: Partial<typeof defaults> = {};
  try {
    const raw = window.localStorage.getItem(COLLAB_STORAGE_KEY);
    if (raw) {
      stored = JSON.parse(raw) as Partial<typeof defaults>;
    }
  } catch (error) {
    logClient("collaboration:storage:read:error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const invite = readPageInvite();
  const paramRoom = invite.room;
  const room = paramRoom || defaults.room;
  const password = invite.password || defaults.password;
  const signalingParam = invite.signal;
  const signaling = signalingParam
    ? parseSignalingUrls(signalingParam).join(", ")
    : migrateLegacyStoredSignaling(stored.signaling, defaults.signaling);

  return {
    room,
    password,
    signaling,
    name: stored.name || defaults.name,
    color: stored.color || defaults.color,
    autoConnect: Boolean(paramRoom),
  };
}

function buildShareRoomName() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

export function parseCollaborationInvite(value: string) {
  const rawValue = value.trim();
  if (!rawValue) {
    throw new Error("Paste the share URL first.");
  }

  const { room, signal, password } = parseInviteParams(rawValue);
  if (!room) {
    throw new Error("That invite is missing a room name.");
  }

  return {
    room,
    signaling: signal || DEFAULT_SIGNALING_URLS.join(", "),
    password,
  };
}

export function getCollaborationRole(
  mode: CollaborationMode,
): CollaborationRole {
  return mode === "sharing" ? "host" : "guest";
}

function summarizeCollaborationState(
  mode: CollaborationMode,
  state: CollaborationConnectionState,
  isStartingShare: boolean,
  isStartingConnect: boolean,
): { label: string; tone: CollaborationTone } {
  if (isStartingShare) {
    return { label: "Starting share...", tone: "pending" };
  }

  if (isStartingConnect) {
    return { label: "Connecting...", tone: "pending" };
  }

  if (mode === "idle") {
    return { label: "Not connected", tone: "idle" };
  }

  return summarizeCollaboration(getCollaborationRole(mode), state.diagnostics);
}

export function buildCollaborationViewModel(
  mode: CollaborationMode,
  state: CollaborationConnectionState,
  isStartingShare: boolean,
  isStartingConnect: boolean,
  activeShareRoom: string,
  collaborationSignaling: string,
  iceServers: RTCIceServer[],
) {
  const remoteCollaborators = state.collaborators.filter(
    (collaborator) => !collaborator.isLocal,
  );
  const remoteCursors: CollaborationRemoteCursor[] =
    remoteCollaborators.flatMap((collaborator) =>
      collaborator.cursor
        ? [
            {
              clientId: collaborator.clientId,
              name: collaborator.name,
              color: collaborator.color,
              x: collaborator.cursor.x,
              y: collaborator.cursor.y,
            },
          ]
        : [],
    );

  const summary = summarizeCollaborationState(
    mode,
    state,
    isStartingShare,
    isStartingConnect,
  );

  return {
    pendingShareRoom: activeShareRoom || buildShareRoomName(),
    signalingLabel: parseSignalingUrls(collaborationSignaling).join(", "),
    stateLabel: summary.label,
    stateTone: summary.tone,
    diagnosticsRows:
      mode === "idle"
        ? []
        : buildDiagnosticsRows(
            getCollaborationRole(mode),
            state.diagnostics,
            iceServers,
          ),
    remoteCollaboratorNames: remoteCollaborators
      .map((collaborator) => collaborator.name)
      .join(", "),
    remoteCursors,
  };
}
