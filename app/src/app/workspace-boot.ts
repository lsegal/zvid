import type { ImportNoticeContent } from "../components/ImportNotice";
import { migrateDefaultGain } from "../default-gain.ts";
import { type MediaItem, toShareableMediaItem } from "../media.ts";
import type { ProjectHistoryState } from "../project-history.ts";
import {
  migrateClipContentEffects,
  migrateColorizeReactivity,
  migrateDefaultOrder,
  migrateMainAudio,
  migrateOrderOuterMargin,
  stripLegacySnapMode,
} from "../project-state-compat.ts";
import { createWorkspaceLock } from "../workspace-lock.ts";
import { parseWorkspaceSession } from "../workspace-session.ts";
import { getWorkspaceStore } from "../workspace-store.ts";
import { readPageInvite } from "./collaboration-config.ts";
import { INITIAL_PROJECT_STATE } from "./constants.ts";
import {
  findRestoredSourceSelection,
  type SourceSelection,
} from "./source-selection.ts";
import type { ProjectState } from "./types.ts";
import { logClient } from "./util.ts";
import type {
  SavedWorkspaceSession,
  WorkspaceBoot,
  WorkspaceView,
} from "./workspace-types.ts";

const PROJECT_ARRAY_FIELDS = [
  "mediaItems",
  "lanes",
  "sourceTracks",
  "sourceSpans",
  "clips",
  "effects",
] as const;

const PROJECT_POSITIVE_NUMBER_FIELDS = [
  "bpm",
  "fps",
  "canvasWidth",
  "canvasHeight",
  "zoom",
] as const;

// Restored history shares objects between snapshots; normalizing each
// shared object once keeps that sharing.
const restoredProjectStates = new WeakMap<object, ProjectState>();

const restoredMediaItems = new WeakMap<object, MediaItem>();

// Validates a saved snapshot, fills in fields older saves lack and drops
// object URLs, which die with the page that made them.
function normalizeRestoredProjectState(value: unknown): ProjectState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved project snapshot is not an object");
  }
  const cached = restoredProjectStates.get(value);
  if (cached) {
    return cached;
  }

  const saved = value as Partial<ProjectState>;
  let state: ProjectState = {
    ...INITIAL_PROJECT_STATE,
    ...stripLegacySnapMode(saved),
  };
  for (const field of PROJECT_ARRAY_FIELDS) {
    if (!Array.isArray(state[field])) {
      throw new Error(`Saved project snapshot has no ${field}`);
    }
  }
  state = migrateMainAudio(state);
  // Read from the save itself: the initial state always has the flag.
  state.effects = migrateDefaultGain(
    migrateClipContentEffects(
      migrateDefaultOrder(
        migrateOrderOuterMargin(migrateColorizeReactivity(state.effects)),
        saved.orderDefaulted,
      ),
      state.clips,
      saved.clipContentEffects,
    ),
    { clips: state.clips, sourceSpans: state.sourceSpans },
    state.mediaItems,
    saved.audioGainDefaulted,
  );
  state.orderDefaulted = true;
  state.clipContentEffects = true;
  state.audioGainDefaulted = true;
  for (const field of PROJECT_POSITIVE_NUMBER_FIELDS) {
    const number = state[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) {
      throw new Error(`Saved project snapshot has an invalid ${field}`);
    }
  }
  state.mediaItems = state.mediaItems.map((item) => {
    let shareable = restoredMediaItems.get(item);
    if (!shareable) {
      shareable = toShareableMediaItem(item);
      restoredMediaItems.set(item, shareable);
    }
    return shareable;
  });
  restoredProjectStates.set(value, state);
  return state;
}

function normalizeRestoredView(value: unknown): WorkspaceView {
  const view = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const finite = (field: unknown) =>
    typeof field === "number" && Number.isFinite(field)
      ? Math.max(0, field)
      : 0;
  const text = (field: unknown) =>
    typeof field === "string" && field ? field : undefined;
  return {
    playheadQ: finite(view.playheadQ),
    selectedClipId: text(view.selectedClipId),
    selectedLaneId: text(view.selectedLaneId),
    selectedSourceTrackId: text(view.selectedSourceTrackId),
    selectedSourceSpanId: text(view.selectedSourceSpanId),
    scrollLeft: finite(view.scrollLeft),
    scrollTop: finite(view.scrollTop),
  };
}

// Reads the saved session. One that cannot be read is set aside under a
// `corrupt-<ts>` key so the app starts clean instead of failing every load.
export async function readSavedWorkspaceSession(): Promise<{
  session: SavedWorkspaceSession | null;
  corruptKey: string | null;
}> {
  const store = getWorkspaceStore();
  try {
    const record = await store.loadCurrentSession();
    if (!record) {
      return { session: null, corruptKey: null };
    }
    return {
      session: parseWorkspaceSession<
        ProjectState,
        WorkspaceView,
        ImportNoticeContent
      >(record.payload, {
        normalizeState: normalizeRestoredProjectState,
        normalizeView: normalizeRestoredView,
      }),
      corruptKey: null,
    };
  } catch (error) {
    logClient("workspace:restore:error", {
      message: error instanceof Error ? error.message : String(error),
    });
    try {
      return {
        session: null,
        corruptKey: await store.setAsideCurrentSession(),
      };
    } catch {
      // IndexedDB itself is unavailable, so there is nothing to set aside.
      return { session: null, corruptKey: null };
    }
  }
}

// Lock callbacks outlive a single render, so they reach the mounted App
// through this object.
export const workspaceLockEvents = {
  flush: async () => {},
  lost: () => {},
};

async function loadWorkspaceBoot(): Promise<WorkspaceBoot> {
  const lock = createWorkspaceLock({
    onFlushRequest: () => workspaceLockEvents.flush(),
    onLost: () => workspaceLockEvents.lost(),
  });
  // A joiner shows someone else's session, and a refresh rejoins it from the
  // URL, so the joiner's own saved session is neither restored nor replaced.
  if (readPageInvite().room) {
    return { session: null, corruptKey: null, access: "joiner", lock };
  }

  const owner = await lock.acquire();
  const { session, corruptKey } = await readSavedWorkspaceSession();
  return { session, corruptKey, access: owner ? "owner" : "blocked", lock };
}

let workspaceBootPromise: Promise<WorkspaceBoot> | null = null;

export function bootWorkspace() {
  workspaceBootPromise ??= loadWorkspaceBoot();
  return workspaceBootPromise;
}

export function isPristineProjectHistory(
  history: ProjectHistoryState<ProjectState>,
) {
  return (
    history.present === INITIAL_PROJECT_STATE &&
    !history.past.length &&
    !history.future.length
  );
}

export function findRestoredSelection(
  session: SavedWorkspaceSession | null,
): Pick<WorkspaceView, "selectedClipId" | "selectedLaneId"> & {
  sourceSelection?: SourceSelection;
} {
  if (!session) {
    return {};
  }
  const { clips, lanes, sourceTracks, sourceSpans } = session.history.present;
  const { selectedClipId, selectedLaneId } = session.view;
  return {
    sourceSelection: findRestoredSourceSelection(
      session.view,
      sourceTracks,
      sourceSpans,
    ),
    selectedClipId: clips.some((clip) => clip.id === selectedClipId)
      ? selectedClipId
      : undefined,
    selectedLaneId: lanes.some((lane) => lane.id === selectedLaneId)
      ? selectedLaneId
      : undefined,
  };
}

export const CORRUPT_WORKSPACE_NOTICE: ImportNoticeContent = {
  tone: "warning",
  title: "Could not restore the last session",
  lines: [
    "The saved session could not be read, so zvid started with an empty session. The saved copy was set aside.",
  ],
};

export function formatRestoredStatus(session: SavedWorkspaceSession) {
  const name = session.history.present.sessionName;
  return name ? `Restored ${name}.` : "Restored the last session.";
}
