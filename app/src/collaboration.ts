import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import {
  type CollaborationDiagnostics,
  type CollaborationRole,
  PEER_UNREACHABLE_MESSAGE,
} from "./collaboration-diagnostics";
import {
  createMediaTransport,
  type MediaRequestOptions,
  type MediaResolver,
} from "./collaboration-media";

// No signaling server connected within this long is reported as unreachable.
const SIGNALING_TIMEOUT_MS = 10000;
// A discovered peer whose WebRTC connection hasn't opened within this long is
// reported as unreachable; usually NAT that needs TURN.
const PEER_CONNECT_TIMEOUT_MS = 15000;
// A guest that has found no host within this long is told so.
const HOST_TIMEOUT_MS = 20000;

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type CollaboratorPresence = {
  clientId: number;
  name: string;
  color: string;
  cursor?: {
    x: number;
    y: number;
  };
  isLocal: boolean;
};

export type CollaborationConnectionState = {
  connected: boolean;
  peerCount: number;
  mediaPeerCount: number;
  collaborators: CollaboratorPresence[];
  diagnostics: CollaborationDiagnostics;
};

type CollaborationUser = {
  name: string;
  color: string;
};

type CollaborationCursor = {
  x: number;
  y: number;
};

type CollaborationAwarenessState = {
  user?: Partial<CollaborationUser>;
  cursor?: Partial<CollaborationCursor> | null;
};

type CollaborationLog = (event: string, payload?: unknown) => void;

type CollaborationControllerOptions<T extends Record<string, unknown>> = {
  roomName: string;
  password?: string;
  signalingUrls?: string[];
  // The host publishes its project when the room is empty; a guest only ever
  // adopts the room's state, so a guest that connects slowly can't overwrite
  // the host's project with its own.
  role: CollaborationRole;
  iceServers?: RTCIceServer[];
  log?: CollaborationLog;
  initialState: T;
  bootstrapState: T;
  user: CollaborationUser;
  onRemoteState(state: T): void;
  onConnectionState(state: CollaborationConnectionState): void;
  resolveMedia?: MediaResolver;
};

export type CollaborationController<T extends Record<string, unknown>> = {
  pushState(state: T): void;
  updateUser(user: CollaborationUser): void;
  updateCursor(cursor: CollaborationCursor | null): void;
  requestMedia(
    mediaId: string,
    options?: MediaRequestOptions,
  ): Promise<Blob | null>;
  destroy(): void;
};

function normalizeCursor(
  cursor: Partial<CollaborationCursor> | null | undefined,
) {
  if (!cursor || typeof cursor !== "object") {
    return undefined;
  }

  if (typeof cursor.x !== "number" || typeof cursor.y !== "number") {
    return undefined;
  }

  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    return undefined;
  }

  return {
    x: Math.min(1, Math.max(0, cursor.x)),
    y: Math.min(1, Math.max(0, cursor.y)),
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry) ?? null);
  }

  if (typeof value === "object") {
    const next: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = toJsonValue(entry);
      if (normalized !== undefined) {
        next[key] = normalized;
      }
    }
    return next;
  }

  return undefined;
}

function jsonEquals(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function materializeState<T extends Record<string, unknown>>(
  root: Y.Map<unknown>,
  initialState: T,
) {
  return {
    ...cloneJson(initialState),
    ...(root.toJSON() as Partial<T>),
  };
}

function applyStateToRoot<T extends Record<string, unknown>>(
  root: Y.Map<unknown>,
  state: T,
) {
  const normalized = toJsonValue(state);
  if (
    !normalized ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  ) {
    throw new Error("Collaborative project state must be a JSON object.");
  }

  const nextEntries = Object.entries(normalized);
  const nextKeys = new Set(nextEntries.map(([key]) => key));

  for (const key of Array.from(root.keys())) {
    if (!nextKeys.has(key)) {
      root.delete(key);
    }
  }

  for (const [key, value] of nextEntries) {
    if (!jsonEquals(root.get(key), value)) {
      root.set(key, value);
    }
  }
}

function mapCollaborators(provider: WebrtcProvider): CollaboratorPresence[] {
  return Array.from(provider.awareness.getStates().entries())
    .map(([clientId, state]) => {
      const awarenessState = state as CollaborationAwarenessState;
      const user = awarenessState.user;
      return {
        clientId,
        name:
          typeof user?.name === "string" && user.name.trim()
            ? user.name
            : `Guest ${clientId}`,
        color:
          typeof user?.color === "string" && user.color.trim()
            ? user.color
            : "#7ca1ff",
        cursor: normalizeCursor(awarenessState.cursor),
        isLocal: clientId === provider.doc.clientID,
      };
    })
    .sort(
      (left, right) =>
        Number(right.isLocal) - Number(left.isLocal) ||
        left.name.localeCompare(right.name),
    );
}

type PeerLike = {
  connected: boolean;
  on(event: string, listener: (...args: never[]) => void): void;
  removeListener(event: string, listener: (...args: never[]) => void): void;
};

type TrackedPeer = {
  peer: PeerLike;
  connected: boolean;
  stalled: boolean;
  stallTimer: number;
  detach(): void;
};

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createCollaborationController<
  T extends Record<string, unknown>,
>(options: CollaborationControllerOptions<T>): CollaborationController<T> {
  const doc = new Y.Doc();
  const root = doc.getMap("project");
  const localOrigin = Symbol("zvid-collaboration-local");
  const log: CollaborationLog = options.log ?? (() => {});
  const isHost = options.role === "host";
  let destroyed = false;
  let bootstrapped = false;
  let latestBootstrapState = options.bootstrapState;
  let signalingTimedOut = false;
  let hostTimedOut = false;
  let lastError: string | null = null;
  const trackedPeers = new Map<string, TrackedPeer>();
  const provider = new WebrtcProvider(options.roomName, doc, {
    password: options.password?.trim() || undefined,
    signaling:
      options.signalingUrls && options.signalingUrls.length > 0
        ? options.signalingUrls
        : undefined,
    peerOpts: options.iceServers
      ? { config: { iceServers: options.iceServers } }
      : undefined,
  });

  log("collaboration:room:join", {
    room: options.roomName,
    role: options.role,
    signaling: provider.signalingUrls,
    iceServers: options.iceServers?.map((server) => server.urls),
    password: Boolean(options.password?.trim()),
  });

  const media = createMediaTransport({
    provider,
    resolveMedia: options.resolveMedia,
    onChange: () => emitConnectionState(),
    log,
  });

  const getDiagnostics = (): CollaborationDiagnostics => {
    let peersConnected = 0;
    let peersStalled = 0;
    for (const tracked of trackedPeers.values()) {
      if (tracked.connected) {
        peersConnected += 1;
      } else if (tracked.stalled) {
        peersStalled += 1;
      }
    }
    return {
      signaling: provider.signalingConns.map((conn) => ({
        url: conn.url,
        connected: conn.connected,
      })),
      signalingTimedOut,
      peersFound: trackedPeers.size,
      peersConnected,
      peersStalled,
      sameBrowserPeers: provider.room?.bcConns.size ?? 0,
      synced: bootstrapped,
      hostTimedOut,
      lastError,
    };
  };

  const emitConnectionState = () => {
    if (destroyed) {
      return;
    }

    const collaborators = mapCollaborators(provider);
    options.onConnectionState({
      connected: provider.connected,
      peerCount: collaborators.filter((collaborator) => !collaborator.isLocal)
        .length,
      mediaPeerCount: media.mediaPeerCount,
      collaborators,
      diagnostics: getDiagnostics(),
    });
  };

  const setLastError = (message: string) => {
    lastError = message;
    emitConnectionState();
  };

  const emitRemoteState = () => {
    if (destroyed) {
      return;
    }

    options.onRemoteState(materializeState(root, options.initialState));
  };

  const markSynced = (source: string) => {
    if (bootstrapped) {
      return;
    }
    bootstrapped = true;
    window.clearTimeout(bootstrapTimer);
    log("collaboration:sync:first", { source, keys: root.size });
  };

  const bootstrapFromCurrentRoom = () => {
    if (destroyed || bootstrapped) {
      return;
    }

    if (root.size === 0) {
      markSynced("host");
      doc.transact(() => {
        applyStateToRoot(root, latestBootstrapState);
      }, localOrigin);
    } else {
      markSynced("room");
      emitRemoteState();
    }
    emitConnectionState();
  };

  // Only the host seeds an empty room, after giving an existing room (a host
  // reloading its own share) a moment to arrive.
  const bootstrapTimer = isHost
    ? window.setTimeout(bootstrapFromCurrentRoom, 1200)
    : 0;

  root.observe((_event, transaction) => {
    if (destroyed || transaction.origin === localOrigin) {
      return;
    }

    markSynced("peer");
    emitRemoteState();
    emitConnectionState();
  });

  // Signaling sockets are shared by every provider on the page, so these
  // listeners are removed again on destroy.
  const signalingCleanups = provider.signalingConns.map((conn) => {
    const onConnect = () => {
      log("collaboration:signaling:connect", { url: conn.url });
      emitConnectionState();
    };
    const onDisconnect = () => {
      log("collaboration:signaling:close", { url: conn.url });
      emitConnectionState();
    };
    conn.on("connect", onConnect);
    conn.on("disconnect", onDisconnect);
    return () => {
      conn.off("connect", onConnect);
      conn.off("disconnect", onDisconnect);
    };
  });

  const signalingTimer = window.setTimeout(() => {
    if (!provider.signalingConns.some((conn) => conn.connected)) {
      signalingTimedOut = true;
      log("collaboration:signaling:timeout", { urls: provider.signalingUrls });
      setLastError(
        `No signaling server reachable (${provider.signalingUrls.join(", ")}).`,
      );
    }
  }, SIGNALING_TIMEOUT_MS);

  const hostTimer = isHost
    ? 0
    : window.setTimeout(() => {
        if (!bootstrapped && trackedPeers.size === 0) {
          hostTimedOut = true;
          log("collaboration:host:timeout", { room: options.roomName });
          emitConnectionState();
        }
      }, HOST_TIMEOUT_MS);

  const untrackPeer = (peerId: string) => {
    const tracked = trackedPeers.get(peerId);
    if (!tracked) {
      return;
    }
    window.clearTimeout(tracked.stallTimer);
    tracked.detach();
    trackedPeers.delete(peerId);
  };

  const trackPeer = (peerId: string, peer: PeerLike) => {
    log("collaboration:peer:discovered", { peerId });
    const tracked: TrackedPeer = {
      peer,
      connected: peer.connected,
      stalled: false,
      stallTimer: 0,
      detach: () => {},
    };
    const onConnect = () => {
      tracked.connected = true;
      tracked.stalled = false;
      window.clearTimeout(tracked.stallTimer);
      log("collaboration:peer:channel:open", { peerId });
      emitConnectionState();
    };
    const onIceStateChange = (
      iceConnectionState: string,
      iceGatheringState: string,
    ) => {
      log("collaboration:peer:ice", {
        peerId,
        iceConnectionState,
        iceGatheringState,
      });
    };
    const onError = (error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      log("collaboration:peer:error", {
        peerId,
        code,
        message: describeError(error),
      });
      if (
        code === "ERR_ICE_CONNECTION_FAILURE" ||
        code === "ERR_CONNECTION_FAILURE"
      ) {
        tracked.stalled = true;
        setLastError(`WebRTC connection failed. ${PEER_UNREACHABLE_MESSAGE}.`);
      } else {
        setLastError(`Peer connection error: ${describeError(error)}`);
      }
    };
    const onClose = () => {
      log("collaboration:peer:close", { peerId });
    };
    peer.on("connect", onConnect);
    peer.on("iceStateChange", onIceStateChange);
    peer.on("error", onError);
    peer.on("close", onClose);
    tracked.detach = () => {
      peer.removeListener("connect", onConnect);
      peer.removeListener("iceStateChange", onIceStateChange);
      peer.removeListener("error", onError);
      peer.removeListener("close", onClose);
    };
    if (!tracked.connected) {
      tracked.stallTimer = window.setTimeout(() => {
        if (!tracked.connected && trackedPeers.get(peerId) === tracked) {
          tracked.stalled = true;
          log("collaboration:peer:stalled", { peerId });
          setLastError(
            `A peer was found but no WebRTC connection opened within ${PEER_CONNECT_TIMEOUT_MS / 1000}s. ${PEER_UNREACHABLE_MESSAGE}.`,
          );
        }
      }, PEER_CONNECT_TIMEOUT_MS);
    }
    trackedPeers.set(peerId, tracked);
  };

  // y-webrtc emits "peers" when a peer is discovered or closes, not when its
  // connection opens, so each simple-peer instance is watched directly.
  const syncPeers = () => {
    if (destroyed) {
      return;
    }
    const conns = provider.room?.webrtcConns;
    for (const [peerId, tracked] of Array.from(trackedPeers)) {
      if (conns?.get(peerId)?.peer !== tracked.peer) {
        untrackPeer(peerId);
      }
    }
    conns?.forEach((conn, peerId) => {
      if (!trackedPeers.has(peerId)) {
        trackPeer(peerId, conn.peer as PeerLike);
      }
    });
  };

  provider.on("status", () => {
    syncPeers();
    emitConnectionState();
  });
  provider.on("peers", (event) => {
    syncPeers();
    log("collaboration:peers", {
      added: event.added,
      removed: event.removed,
      webrtcPeers: trackedPeers.size,
      sameBrowserPeers: event.bcPeers.length,
    });
    emitConnectionState();
  });
  provider.awareness.on("change", emitConnectionState);
  provider.on("synced", () => {
    if (!bootstrapped && root.size > 0) {
      markSynced("room");
      emitRemoteState();
    }
    emitConnectionState();
  });

  provider.awareness.setLocalStateField("user", options.user);
  emitConnectionState();

  return {
    pushState(state) {
      latestBootstrapState = state;
      if (destroyed || !bootstrapped) {
        return;
      }

      doc.transact(() => {
        applyStateToRoot(root, state);
      }, localOrigin);
    },

    updateUser(user) {
      if (destroyed) {
        return;
      }

      provider.awareness.setLocalStateField("user", user);
      emitConnectionState();
    },

    updateCursor(cursor) {
      if (destroyed) {
        return;
      }

      provider.awareness.setLocalStateField("cursor", cursor);
    },

    requestMedia(mediaId, requestOptions) {
      return media.requestMedia(mediaId, requestOptions);
    },

    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      window.clearTimeout(bootstrapTimer);
      window.clearTimeout(signalingTimer);
      window.clearTimeout(hostTimer);
      for (const peerId of Array.from(trackedPeers.keys())) {
        untrackPeer(peerId);
      }
      for (const cleanup of signalingCleanups) {
        cleanup();
      }
      media.destroy();
      provider.awareness.setLocalState(null);
      // provider.destroy() (via doc.destroy) leaves the shared signaling
      // sockets open; disconnect closes them once no provider uses them.
      provider.disconnect();
      doc.destroy();
      log("collaboration:room:leave", { room: options.roomName });
    },
  };
}
