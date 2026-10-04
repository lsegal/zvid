// Serializes the current session (project state, undo/redo history and view
// state) into the string stored by the workspace store, and reads it back.
//
// History entries are full project snapshots, but consecutive snapshots
// share every object an edit did not touch. The encoding keeps that sharing:
// each distinct object or array is written once to a node table and every
// later occurrence refers to it by index, so a hundred undo steps cost about
// as much as the objects they actually changed. Decoding rebuilds the same
// sharing, which keeps restored history as light in memory as the original.

import type {
  ProjectHistoryEntry,
  ProjectHistoryState,
} from "./project-history.ts";

export const WORKSPACE_HISTORY_MAX_ENTRIES = 100;
export const WORKSPACE_HISTORY_MAX_BYTES = 20 * 1024 * 1024;

export type WorkspaceSessionSource = (
  | { kind: "none" }
  | { kind: "file"; name: string }
  | { kind: "workspace"; name: string }
  | { kind: "path"; name: string; path: string }
  | { kind: "import"; name: string }
) & {
  // The Sessions library entry the session was opened from or saved to.
  libraryId?: string;
};

export type WorkspaceSession<State, View, Notice = unknown> = {
  history: {
    past: ProjectHistoryEntry<State>[];
    present: State;
    future: ProjectHistoryEntry<State>[];
  };
  view: View;
  source: WorkspaceSessionSource;
  // The summary shown after an Ableton Live set import, kept so a refresh
  // does not lose it.
  importNotice?: Notice | null;
};

export type WorkspaceSessionLimits = {
  maxEntries?: number;
  maxBytes?: number;
};

// A node is an array or a plain object whose children are either JSON
// primitives or `[index]` references to other nodes. Arrays never appear
// inline, so a one-element array in a child position is always a reference.
type EncodedChild = string | number | boolean | null | [number];
type EncodedNode = { a: EncodedChild[] } | { o: Record<string, EncodedChild> };

type EncodedHistoryEntry = { label: string; snapshot: EncodedChild };

type EncodedSession = {
  nodes: EncodedNode[];
  past: EncodedHistoryEntry[];
  present: EncodedChild;
  future: EncodedHistoryEntry[];
  view: EncodedChild;
  source: WorkspaceSessionSource;
  importNotice: EncodedChild;
};

class GraphEncoder {
  readonly nodes: EncodedNode[] = [];
  private readonly ids = new Map<object, number>();

  encode(value: unknown): EncodedChild {
    if (value === null || value === undefined) {
      return null;
    }
    switch (typeof value) {
      case "string":
      case "boolean":
        return value;
      case "number":
        return Number.isFinite(value) ? value : null;
      case "object":
        break;
      default:
        return null;
    }

    const object = value as object;
    const existing = this.ids.get(object);
    if (existing !== undefined) {
      return [existing];
    }

    const id = this.nodes.length;
    this.ids.set(object, id);
    // Reserve the slot first so cycles cannot recurse forever.
    this.nodes.push({ a: [] });
    if (Array.isArray(object)) {
      this.nodes[id] = { a: object.map((item) => this.encode(item)) };
    } else {
      const fields: Record<string, EncodedChild> = {};
      for (const [key, child] of Object.entries(object)) {
        // Like JSON.stringify, unset optional fields are left out.
        if (child !== undefined && typeof child !== "function") {
          fields[key] = this.encode(child);
        }
      }
      this.nodes[id] = { o: fields };
    }
    return [id];
  }
}

class GraphDecoder {
  private readonly values: unknown[] = [];
  private readonly nodes: EncodedNode[];

  constructor(nodes: EncodedNode[]) {
    if (!Array.isArray(nodes)) {
      throw new Error("Saved session has no node table");
    }
    this.nodes = nodes;
  }

  decode(child: EncodedChild): unknown {
    if (!Array.isArray(child)) {
      return child;
    }

    const [id] = child;
    if (this.values[id] !== undefined) {
      return this.values[id];
    }
    const node = this.nodes[id];
    if (!node || typeof node !== "object") {
      throw new Error(`Saved session refers to missing node ${id}`);
    }
    if ("a" in node && Array.isArray(node.a)) {
      const items: unknown[] = [];
      this.values[id] = items;
      for (const item of node.a) {
        items.push(this.decode(item));
      }
      return items;
    }
    if ("o" in node && node.o && typeof node.o === "object") {
      const fields: Record<string, unknown> = {};
      this.values[id] = fields;
      for (const [key, item] of Object.entries(node.o)) {
        fields[key] = this.decode(item);
      }
      return fields;
    }
    throw new Error(`Saved session node ${id} is malformed`);
  }
}

function encodeSession<State, View, Notice>(
  session: WorkspaceSession<State, View, Notice>,
): string {
  const encoder = new GraphEncoder();
  const encodeEntries = (entries: ProjectHistoryEntry<State>[]) =>
    entries.map((entry) => ({
      label: entry.label,
      snapshot: encoder.encode(entry.snapshot),
    }));
  // Present first, then history nearest to it, so the node table is ordered
  // roughly by how likely a node is to be needed.
  const present = encoder.encode(session.history.present);
  const past = encodeEntries(session.history.past);
  const future = encodeEntries(session.history.future);
  const encoded: EncodedSession = {
    nodes: encoder.nodes,
    past,
    present,
    future,
    view: encoder.encode(session.view),
    source: session.source,
    importNotice: encoder.encode(session.importNotice ?? null),
  };
  return JSON.stringify(encoded);
}

// Keeps the most recent `maxEntries` undo steps and the nearest `maxEntries`
// redo steps.
export function capHistory<State>(
  history: WorkspaceSession<State, unknown>["history"],
  maxEntries = WORKSPACE_HISTORY_MAX_ENTRIES,
) {
  const limit = Math.max(0, Math.floor(maxEntries));
  return {
    past: history.past.slice(Math.max(0, history.past.length - limit)),
    present: history.present,
    future: history.future.slice(0, limit),
  };
}

// Encodes the session for storage, dropping the oldest undo steps (and the
// furthest redo steps) until it fits the entry and size limits.
export function serializeWorkspaceSession<State, View, Notice>(
  session: WorkspaceSession<State, View, Notice>,
  limits: WorkspaceSessionLimits = {},
): string {
  const maxBytes = limits.maxBytes ?? WORKSPACE_HISTORY_MAX_BYTES;
  let history = capHistory(session.history, limits.maxEntries);
  for (;;) {
    const payload = encodeSession({ ...session, history });
    const { past, future } = history;
    // UTF-16 length is a cheap upper bound on what IndexedDB stores.
    if (payload.length * 2 <= maxBytes || (!past.length && !future.length)) {
      return payload;
    }
    // Drop a quarter of the remaining history per pass so an oversized
    // session converges quickly instead of re-encoding once per entry.
    const pastDrop = Math.ceil(past.length / 4);
    const futureDrop = Math.ceil(future.length / 4);
    history = {
      past: past.slice(pastDrop),
      present: history.present,
      future: future.slice(0, future.length - futureDrop),
    };
  }
}

export type ParseWorkspaceSessionOptions<State, View> = {
  // Validates a decoded snapshot and fills in fields that older saves lack.
  // Throwing marks the saved session as corrupt.
  normalizeState(value: unknown): State;
  normalizeView(value: unknown): View;
};

function parseSource(value: unknown): WorkspaceSessionSource {
  if (!value || typeof value !== "object") {
    return { kind: "none" };
  }
  const source = value as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name : "";
  const library =
    typeof source.libraryId === "string" ? { libraryId: source.libraryId } : {};
  switch (source.kind) {
    case "file":
    case "workspace":
    case "import":
      return { kind: source.kind, name, ...library };
    case "path":
      return typeof source.path === "string"
        ? { kind: "path", name, path: source.path, ...library }
        : { kind: "none", ...library };
    default:
      return { kind: "none", ...library };
  }
}

// Reads a payload written by serializeWorkspaceSession. Throws when the
// payload cannot be parsed or a snapshot fails validation.
export function parseWorkspaceSession<State, View, Notice = unknown>(
  payload: string,
  options: ParseWorkspaceSessionOptions<State, View>,
): WorkspaceSession<State, View, Notice> {
  const encoded = JSON.parse(payload) as EncodedSession;
  if (!encoded || typeof encoded !== "object") {
    throw new Error("Saved session is not an object");
  }
  const decoder = new GraphDecoder(encoded.nodes);
  const decodeEntries = (entries: unknown) => {
    if (!Array.isArray(entries)) {
      throw new Error("Saved session history is malformed");
    }
    return entries.map((entry: EncodedHistoryEntry) => ({
      label: typeof entry?.label === "string" ? entry.label : "Edit",
      snapshot: options.normalizeState(decoder.decode(entry?.snapshot)),
    }));
  };

  const importNotice = decoder.decode(encoded.importNotice ?? null);
  return {
    history: {
      past: decodeEntries(encoded.past),
      present: options.normalizeState(decoder.decode(encoded.present)),
      future: decodeEntries(encoded.future),
    },
    view: options.normalizeView(decoder.decode(encoded.view ?? null)),
    source: parseSource(encoded.source),
    importNotice: (importNotice ?? null) as Notice | null,
  };
}

export function toProjectHistoryState<State>(
  history: WorkspaceSession<State, unknown>["history"],
): ProjectHistoryState<State> {
  return {
    past: history.past,
    present: history.present,
    future: history.future,
  };
}
