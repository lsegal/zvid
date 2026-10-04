import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { isPristineProjectHistory } from "../app/new-session.ts";
import type { ProjectState } from "../app/types.ts";
import { logClient } from "../app/util.ts";
import { parseSavedWorkspaceSession } from "../app/workspace-boot.ts";
import type { SavedWorkspaceSession } from "../app/workspace-types.ts";
import type { ProjectHistoryState } from "../project-history";
import {
  createSessionLibraryId,
  getDuplicateName,
  getSessionContentHash,
  getSessionLibraryName,
  getSessionLibraryStore,
  type SessionLibraryEntry,
  type SessionLibrarySummary,
} from "../session-library.ts";
import { matchesShortcutKey } from "../shortcuts/keys.ts";
import {
  serializeWorkspaceSession,
  type WorkspaceSessionSource,
} from "../workspace-session.ts";

export type SessionLibraryInputs = {
  projectHistory: ProjectHistoryState<ProjectState>;
  sessionSource: WorkspaceSessionSource;
  setSessionSource: Dispatch<SetStateAction<WorkspaceSessionSource>>;
  readWorkspaceSession: () => SavedWorkspaceSession;
  openWorkspaceSession: (session: SavedWorkspaceSession) => void;
  refuseReadOnlyEdit: () => boolean;
  setHasUnsavedChanges: Dispatch<SetStateAction<boolean>>;
  setStatus: (message: string) => void;
};

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withoutLibraryId(
  source: WorkspaceSessionSource,
): WorkspaceSessionSource {
  const { libraryId: _libraryId, ...rest } = source;
  return rest;
}

// The Sessions library: every session that was saved (File › Save, ⌘S) or
// opened, kept locally until deleted. Saving updates the entry the session
// came from, or adds one; opening a file or the sample adds one too. Entries
// open, rename, duplicate and delete from the Sessions tab.
export function useSessionLibrary({
  projectHistory,
  sessionSource,
  setSessionSource,
  readWorkspaceSession,
  openWorkspaceSession,
  refuseReadOnlyEdit,
  setHasUnsavedChanges,
  setStatus,
}: SessionLibraryInputs) {
  const [entries, setEntries] = useState<SessionLibrarySummary[]>([]);
  // An entry waiting on the unsaved-changes prompt, or on delete confirmation.
  const [pendingOpen, setPendingOpen] = useState<SessionLibrarySummary | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] =
    useState<SessionLibrarySummary | null>(null);
  const libraryId = sessionSource.libraryId;
  // The library entry this tab already knows the session belongs to. A new
  // id on the session source means a session was just opened from a file.
  const knownIdRef = useRef(libraryId);
  const latest = useRef({
    projectHistory,
    sessionSource,
    readWorkspaceSession,
    openWorkspaceSession,
    refuseReadOnlyEdit,
    setStatus,
  });
  latest.current = {
    projectHistory,
    sessionSource,
    readWorkspaceSession,
    openWorkspaceSession,
    refuseReadOnlyEdit,
    setStatus,
  };

  const refresh = useCallback(async () => {
    try {
      setEntries(await getSessionLibraryStore().list());
    } catch (error) {
      logClient("sessionLibrary:list:error", { message: describeError(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Writes the open session to entry `id`, keeping an existing entry's name.
  const writeEntry = useCallback(
    async (id: string): Promise<SessionLibraryEntry> => {
      const store = getSessionLibraryStore();
      const saved = latest.current.readWorkspaceSession();
      const present = saved.history.present;
      const existing = await store.get(id);
      const now = Date.now();
      const entry: SessionLibraryEntry = {
        id,
        name: existing?.name ?? getSessionLibraryName(present.sessionName),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        clipCount: present.clips.length,
        contentHash: getSessionContentHash(present),
        // Undo history stays with the open session, not its snapshot, and
        // the snapshot is the saved session, so it reopens with nothing
        // unsaved.
        payload: serializeWorkspaceSession({
          ...saved,
          history: { past: [], present, future: [] },
          view: { ...saved.view, hasUnsavedChanges: false },
          source: withoutLibraryId(saved.source),
        }),
      };
      await store.put(entry);
      return entry;
    },
    [],
  );

  // A session just opened from a file or the sample gets its own entry.
  useEffect(() => {
    if (!libraryId || libraryId === knownIdRef.current) {
      knownIdRef.current = libraryId;
      return;
    }
    knownIdRef.current = libraryId;
    void writeEntry(libraryId)
      .then(refresh)
      .catch((error: unknown) =>
        logClient("sessionLibrary:record:error", {
          message: describeError(error),
        }),
      );
  }, [libraryId, refresh, writeEntry]);

  // File › Save: saves the session into the library.
  const saveToLibrary = useCallback(async () => {
    const { projectHistory, sessionSource, refuseReadOnlyEdit, setStatus } =
      latest.current;
    if (refuseReadOnlyEdit()) {
      return false;
    }
    if (isPristineProjectHistory(projectHistory)) {
      setStatus("Nothing to save yet.");
      return false;
    }
    const id = sessionSource.libraryId ?? createSessionLibraryId();
    try {
      const entry = await writeEntry(id);
      knownIdRef.current = id;
      setSessionSource((current) => ({ ...current, libraryId: id }));
      setHasUnsavedChanges(false);
      setStatus(`Saved ${entry.name} to Sessions.`);
      await refresh();
      return true;
    } catch (error) {
      setStatus(`Save failed: ${describeError(error)}`);
      return false;
    }
  }, [refresh, setHasUnsavedChanges, setSessionSource, writeEntry]);

  const openNow = useCallback(
    async (summary: SessionLibrarySummary) => {
      const { setStatus } = latest.current;
      try {
        const store = getSessionLibraryStore();
        const entry = await store.get(summary.id);
        if (!entry) {
          setStatus(`${summary.name} is no longer in Sessions.`);
          await refresh();
          return;
        }
        const session = parseSavedWorkspaceSession(entry.payload);
        knownIdRef.current = entry.id;
        latest.current.openWorkspaceSession({
          ...session,
          source: { ...session.source, libraryId: entry.id },
        });
        await store.update(entry.id, { updatedAt: Date.now() });
        setStatus(`Opened ${entry.name}.`);
        await refresh();
      } catch (error) {
        setStatus(`Could not open ${summary.name}: ${describeError(error)}`);
      }
    },
    [refresh],
  );

  // Whether the open session has changes its library entry doesn't.
  function hasUnsavedChanges() {
    const { projectHistory, sessionSource } = latest.current;
    if (isPristineProjectHistory(projectHistory)) {
      return false;
    }
    const entry = entries.find((item) => item.id === sessionSource.libraryId);
    return (
      !entry ||
      entry.contentHash !== getSessionContentHash(projectHistory.present)
    );
  }

  // A click on an entry opens it, first asking what to do with unsaved
  // changes to the open session.
  function openEntry(summary: SessionLibrarySummary) {
    if (latest.current.refuseReadOnlyEdit()) {
      return;
    }
    if (hasUnsavedChanges()) {
      setPendingOpen(summary);
      return;
    }
    void openNow(summary);
  }

  async function resolvePendingOpen(choice: "save" | "discard" | "cancel") {
    const summary = pendingOpen;
    setPendingOpen(null);
    if (!summary || choice === "cancel") {
      return;
    }
    if (choice === "save" && !(await saveToLibrary())) {
      return;
    }
    await openNow(summary);
  }

  async function renameEntry(id: string, name: string) {
    const trimmed = name.trim();
    const entry = entries.find((item) => item.id === id);
    if (!entry || !trimmed || trimmed === entry.name) {
      return;
    }
    try {
      await getSessionLibraryStore().update(id, { name: trimmed });
      await refresh();
    } catch (error) {
      setStatus(`Rename failed: ${describeError(error)}`);
    }
  }

  async function duplicateEntry(id: string) {
    try {
      const store = getSessionLibraryStore();
      const entry = await store.get(id);
      if (!entry) {
        await refresh();
        return;
      }
      const now = Date.now();
      const name = getDuplicateName(
        entry.name,
        entries.map((item) => item.name),
      );
      await store.put({
        ...entry,
        id: createSessionLibraryId(),
        name,
        createdAt: now,
        updatedAt: now,
      });
      setStatus(`Duplicated ${entry.name} as ${name}.`);
      await refresh();
    } catch (error) {
      setStatus(`Duplicate failed: ${describeError(error)}`);
    }
  }

  async function confirmDelete() {
    const summary = pendingDelete;
    setPendingDelete(null);
    if (!summary) {
      return;
    }
    try {
      await getSessionLibraryStore().delete(summary.id);
      // The open session stays open; saving it again adds a new entry.
      if (latest.current.sessionSource.libraryId === summary.id) {
        knownIdRef.current = undefined;
        setSessionSource(withoutLibraryId);
      }
      setStatus(`Deleted ${summary.name} from Sessions.`);
      await refresh();
    } catch (error) {
      setStatus(`Delete failed: ${describeError(error)}`);
    }
  }

  // ⌘S / Ctrl+S saves into the library instead of the browser's page save.
  const saveRef = useRef(saveToLibrary);
  saveRef.current = saveToLibrary;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.shiftKey ||
        event.altKey ||
        !matchesShortcutKey("Mod+S", event)
      ) {
        return;
      }
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    entries,
    currentEntryId: libraryId,
    saveToLibrary,
    openEntry,
    pendingOpen,
    resolvePendingOpen,
    renameEntry,
    duplicateEntry,
    requestDelete: setPendingDelete,
    pendingDelete,
    confirmDelete,
    cancelDelete: () => setPendingDelete(null),
  };
}

export type SessionLibraryState = ReturnType<typeof useSessionLibrary>;
