import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import {
  createMediaTransport,
  type MediaRequestOptions,
  type MediaResolver,
} from "./collaboration-media";

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

type CollaborationControllerOptions<T extends Record<string, unknown>> = {
  roomName: string;
  password?: string;
  signalingUrls?: string[];
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

export function createCollaborationController<
  T extends Record<string, unknown>,
>(options: CollaborationControllerOptions<T>): CollaborationController<T> {
  const doc = new Y.Doc();
  const root = doc.getMap("project");
  const localOrigin = Symbol("zvid-collaboration-local");
  let destroyed = false;
  let bootstrapped = false;
  let latestBootstrapState = options.bootstrapState;
  const provider = new WebrtcProvider(options.roomName, doc, {
    password: options.password?.trim() || undefined,
    signaling:
      options.signalingUrls && options.signalingUrls.length > 0
        ? options.signalingUrls
        : undefined,
  });

  const media = createMediaTransport({
    provider,
    resolveMedia: options.resolveMedia,
    onChange: () => emitConnectionState(),
  });

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
    });
  };

  const emitRemoteState = () => {
    if (destroyed) {
      return;
    }

    options.onRemoteState(materializeState(root, options.initialState));
  };

  const bootstrapFromCurrentRoom = () => {
    if (destroyed || bootstrapped) {
      return;
    }

    bootstrapped = true;
    if (root.size === 0) {
      doc.transact(() => {
        applyStateToRoot(root, latestBootstrapState);
      }, localOrigin);
      return;
    }

    emitRemoteState();
  };

  const bootstrapTimer = window.setTimeout(bootstrapFromCurrentRoom, 1200);

  root.observe((_event, transaction) => {
    if (destroyed || transaction.origin === localOrigin) {
      return;
    }

    bootstrapped = true;
    window.clearTimeout(bootstrapTimer);
    emitRemoteState();
  });

  provider.on("status", emitConnectionState);
  provider.on("peers", emitConnectionState);
  provider.awareness.on("change", emitConnectionState);
  provider.on("synced", () => {
    if (!bootstrapped && root.size > 0) {
      bootstrapped = true;
      window.clearTimeout(bootstrapTimer);
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
      media.destroy();
      provider.awareness.setLocalState(null);
      doc.destroy();
    },
  };
}
