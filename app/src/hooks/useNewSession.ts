import { useEffect, useRef, useState } from "react";
import {
  hasUnsavedSessionChanges,
  isNewSessionShortcut,
} from "../app/new-session.ts";
import type { CollaborationMode, ProjectState } from "../app/types.ts";
import { supportsHarnessCapability } from "../harness";
import type { ProjectHistoryState } from "../project-history";

export type NewSessionInputs = {
  projectHistory: ProjectHistoryState<ProjectState>;
  hasUnsavedChanges: boolean;
  collaborationMode: CollaborationMode;
  refuseReadOnlyEdit: () => boolean;
  // Resolves to whether the session was saved.
  saveSession: () => Promise<boolean>;
  startNewSession: () => void;
};

// File → New Session and ⌘N / Ctrl+N in the desktop app: replaces the
// session with a blank one, first asking to save any unsaved changes. Like
// Close Session, it is off while collaborating, so a host can't wipe the
// peers' project.
export function useNewSession({
  projectHistory,
  hasUnsavedChanges,
  collaborationMode,
  refuseReadOnlyEdit,
  saveSession,
  startNewSession,
}: NewSessionInputs) {
  const [isNewSessionPromptOpen, setIsNewSessionPromptOpen] = useState(false);
  const canStartNewSession = collaborationMode === "idle";

  function handleNewSession() {
    if (!canStartNewSession || refuseReadOnlyEdit()) {
      return;
    }

    if (hasUnsavedSessionChanges(projectHistory, hasUnsavedChanges)) {
      setIsNewSessionPromptOpen(true);
      return;
    }

    startNewSession();
  }

  // A canceled or failed save keeps the session open.
  async function saveAndStartNewSession() {
    setIsNewSessionPromptOpen(false);
    if (await saveSession()) {
      startNewSession();
    }
  }

  function discardAndStartNewSession() {
    setIsNewSessionPromptOpen(false);
    startNewSession();
  }

  const handleNewSessionRef = useRef(handleNewSession);
  handleNewSessionRef.current = handleNewSession;
  useEffect(() => {
    const isDesktopApp = supportsHarnessCapability("native-dialogs");
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !isNewSessionShortcut(event, isDesktopApp)
      ) {
        return;
      }

      event.preventDefault();
      handleNewSessionRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    canStartNewSession,
    handleNewSession,
    isNewSessionPromptOpen,
    setIsNewSessionPromptOpen,
    saveAndStartNewSession,
    discardAndStartNewSession,
  };
}
