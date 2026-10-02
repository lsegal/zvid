import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildCollaborationViewModel,
  forgetJoinedRoom,
  getCollaborationRole,
  getInitialCollaborationConfig,
  getSessionIceServers,
  ICE_SERVERS,
  IDLE_COLLABORATION_STATE,
  parseCollaborationInvite,
  parseSignalingUrls,
  rememberJoinedRoom,
} from "../app/collaboration-config.ts";
import { COLLAB_STORAGE_KEY, INITIAL_PROJECT_STATE } from "../app/constants.ts";
import type {
  ArrangementClip,
  CollaborationMode,
  DragState,
  ProjectState,
  TimelineDragState,
  TimelineSelection,
} from "../app/types.ts";
import { logClient } from "../app/util.ts";
import {
  type CollaborationConnectionState,
  type CollaborationController,
  createCollaborationController,
} from "../collaboration";
import type { ProjectHistoryAction } from "../project-history";
import {
  migrateLegacyMainAudio,
  stripClipSelectionFlags,
  stripLegacySnapMode,
} from "../project-state-compat.ts";
import {
  buildPublicShareUrl,
  removeInviteParams,
  withJoinedRoom,
} from "../share-invite.ts";
import { shareCopyFailedStatus } from "../share-link";

// The collaboration room, mode and connection state, the share and connect
// dialogs, and the view model that shows them. App calls this first, since
// much of App reads the collaboration mode and state.
export function useCollaborationState() {
  const [initialCollaborationConfig] = useState(() =>
    getInitialCollaborationConfig(),
  );
  const [collaborationRoom, setCollaborationRoom] = useState(
    initialCollaborationConfig.room,
  );
  const [collaborationPassword, setCollaborationPassword] = useState(
    initialCollaborationConfig.password,
  );
  const [collaborationSignaling, setCollaborationSignaling] = useState(
    initialCollaborationConfig.signaling,
  );
  const [collaborationName] = useState(initialCollaborationConfig.name);
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>(
    initialCollaborationConfig.autoConnect ? "connected" : "idle",
  );
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isStartingShare, setIsStartingShare] = useState(false);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [connectInviteValue, setConnectInviteValue] = useState("");
  const [isStartingConnect, setIsStartingConnect] = useState(false);
  const [hasCopiedShareInvite, setHasCopiedShareInvite] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [collaborationState, setCollaborationState] =
    useState<CollaborationConnectionState>(IDLE_COLLABORATION_STATE);
  const [collaborationIceServers, setCollaborationIceServers] =
    useState<RTCIceServer[]>(ICE_SERVERS);
  const [isDiagnosticsDialogOpen, setIsDiagnosticsDialogOpen] = useState(false);
  const collaborationColor = initialCollaborationConfig.color;

  const collaborationControllerRef =
    useRef<CollaborationController<ProjectState> | null>(null);
  const shareCopyResetTimeoutRef = useRef<number | null>(null);
  const lastCollaborationCursorRef = useRef("");

  const activeShareRoom = collaborationRoom.trim();
  const isSharing = collaborationMode === "sharing";
  const isConnectedClient = collaborationMode === "connected";
  const collaborationView = useMemo(
    () =>
      buildCollaborationViewModel(
        collaborationMode,
        collaborationState,
        isStartingShare,
        isStartingConnect,
        activeShareRoom,
        collaborationSignaling,
        collaborationIceServers,
      ),
    [
      activeShareRoom,
      collaborationIceServers,
      collaborationMode,
      collaborationSignaling,
      collaborationState,
      isStartingConnect,
      isStartingShare,
    ],
  );

  return {
    initialCollaborationConfig,
    collaborationRoom,
    setCollaborationRoom,
    collaborationPassword,
    setCollaborationPassword,
    collaborationSignaling,
    setCollaborationSignaling,
    collaborationName,
    collaborationMode,
    setCollaborationMode,
    isShareDialogOpen,
    setIsShareDialogOpen,
    isStartingShare,
    setIsStartingShare,
    isConnectDialogOpen,
    setIsConnectDialogOpen,
    connectInviteValue,
    setConnectInviteValue,
    isStartingConnect,
    setIsStartingConnect,
    hasCopiedShareInvite,
    setHasCopiedShareInvite,
    shareUrl,
    setShareUrl,
    collaborationState,
    setCollaborationState,
    collaborationIceServers,
    setCollaborationIceServers,
    isDiagnosticsDialogOpen,
    setIsDiagnosticsDialogOpen,
    collaborationColor,
    collaborationControllerRef,
    shareCopyResetTimeoutRef,
    lastCollaborationCursorRef,
    activeShareRoom,
    isSharing,
    isConnectedClient,
    collaborationView,
  };
}

export type CollaborationStateResult = ReturnType<typeof useCollaborationState>;

export type CollaborationInputs = {
  collaboration: CollaborationStateResult;
  projectState: ProjectState;
  projectSnapshotRef: { current: ProjectState };
  dispatchProjectHistory: Dispatch<ProjectHistoryAction<ProjectState>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  stopTimelineAudibleScrub: () => void;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setTimelineDragState: Dispatch<SetStateAction<TimelineDragState | null>>;
  appShellRef: { current: HTMLDivElement | null };
  resolvePeerMedia: (mediaId: string) => Promise<Blob | null>;
  abortPeerMediaTransfers: () => void;
  flushWorkspaceSession: () => Promise<void>;
  viewingSharedSessionRef: { current: boolean };
  setStatus: Dispatch<SetStateAction<string>>;
};

// Runs the collaboration controller: connects it for the current room,
// applies remote project state, sends this tab's cursor and project, and
// starts, joins, stops or leaves a share.
export function useCollaboration({
  collaboration,
  projectState,
  projectSnapshotRef,
  dispatchProjectHistory,
  setIsPlaying,
  stopTimelineAudibleScrub,
  setDragPreviewClips,
  setDragState,
  setPendingSelection,
  setTimelineDragState,
  appShellRef,
  resolvePeerMedia,
  abortPeerMediaTransfers,
  flushWorkspaceSession,
  viewingSharedSessionRef,
  setStatus,
}: CollaborationInputs) {
  const {
    initialCollaborationConfig,
    collaborationRoom,
    setCollaborationRoom,
    collaborationPassword,
    setCollaborationPassword,
    collaborationSignaling,
    setCollaborationSignaling,
    collaborationName,
    collaborationMode,
    setCollaborationMode,
    setIsShareDialogOpen,
    isStartingShare,
    setIsStartingShare,
    setIsConnectDialogOpen,
    connectInviteValue,
    setConnectInviteValue,
    isStartingConnect,
    setIsStartingConnect,
    setHasCopiedShareInvite,
    setShareUrl,
    setCollaborationState,
    setCollaborationIceServers,
    collaborationColor,
    collaborationControllerRef,
    shareCopyResetTimeoutRef,
    lastCollaborationCursorRef,
    collaborationView,
  } = collaboration;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        COLLAB_STORAGE_KEY,
        JSON.stringify({
          signaling: collaborationSignaling,
          name: collaborationName,
          color: collaborationColor,
        }),
      );
    } catch (error) {
      logClient("collaboration:storage:write:error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [collaborationColor, collaborationName, collaborationSignaling]);

  const applyRemoteProjectState = useCallback(
    (remoteSnapshot: ProjectState) => {
      const snapshot = stripLegacySnapMode(
        stripClipSelectionFlags(migrateLegacyMainAudio(remoteSnapshot)),
      );
      if (
        JSON.stringify(projectSnapshotRef.current) === JSON.stringify(snapshot)
      ) {
        return;
      }

      setIsPlaying(false);
      stopTimelineAudibleScrub();
      setDragPreviewClips(null);
      setDragState(null);
      setPendingSelection(null);
      setTimelineDragState(null);
      dispatchProjectHistory({ type: "replace", snapshot });
    },
    [
      dispatchProjectHistory,
      projectSnapshotRef,
      setDragPreviewClips,
      setDragState,
      setIsPlaying,
      setPendingSelection,
      setTimelineDragState,
      stopTimelineAudibleScrub,
    ],
  );

  useEffect(() => {
    if (collaborationMode === "idle") {
      abortPeerMediaTransfers();
      collaborationControllerRef.current?.destroy();
      collaborationControllerRef.current = null;
      return;
    }

    const roomName = collaborationRoom.trim();
    if (!roomName) {
      abortPeerMediaTransfers();
      collaborationControllerRef.current?.destroy();
      collaborationControllerRef.current = null;
      return;
    }

    let canceled = false;
    let controller: CollaborationController<ProjectState> | null = null;
    void getSessionIceServers().then((iceServers) => {
      if (canceled) {
        return;
      }
      setCollaborationIceServers(iceServers);
      controller = createCollaborationController<ProjectState>({
        roomName,
        password: collaborationPassword.trim(),
        signalingUrls: parseSignalingUrls(collaborationSignaling),
        role: getCollaborationRole(collaborationMode),
        iceServers,
        log: logClient,
        initialState: INITIAL_PROJECT_STATE,
        bootstrapState: projectSnapshotRef.current,
        user: {
          name: collaborationName.trim() || initialCollaborationConfig.name,
          color: collaborationColor,
        },
        onRemoteState: applyRemoteProjectState,
        onConnectionState: setCollaborationState,
        resolveMedia: resolvePeerMedia,
      });
      collaborationControllerRef.current = controller;
    });

    return () => {
      canceled = true;
      if (controller && collaborationControllerRef.current === controller) {
        collaborationControllerRef.current = null;
      }
      abortPeerMediaTransfers();
      controller?.destroy();
    };
  }, [
    abortPeerMediaTransfers,
    applyRemoteProjectState,
    collaborationColor,
    collaborationControllerRef,
    collaborationName,
    collaborationPassword,
    collaborationRoom,
    collaborationSignaling,
    initialCollaborationConfig.name,
    collaborationMode,
    projectSnapshotRef,
    resolvePeerMedia,
    setCollaborationIceServers,
    setCollaborationState,
  ]);

  useEffect(() => {
    collaborationControllerRef.current?.updateUser({
      name: collaborationName.trim() || initialCollaborationConfig.name,
      color: collaborationColor,
    });
  }, [
    collaborationColor,
    collaborationControllerRef,
    collaborationName,
    initialCollaborationConfig.name,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const pushCursor = (cursor: { x: number; y: number } | null) => {
      const nextKey = cursor
        ? `${cursor.x.toFixed(3)}:${cursor.y.toFixed(3)}`
        : "";
      if (lastCollaborationCursorRef.current === nextKey) {
        return;
      }

      lastCollaborationCursorRef.current = nextKey;
      collaborationControllerRef.current?.updateCursor(cursor);
    };

    if (collaborationMode === "idle") {
      pushCursor(null);
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const appShell = appShellRef.current;
      if (!appShell) {
        return;
      }

      const bounds = appShell.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        pushCursor(null);
        return;
      }

      const insideBounds =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;

      if (!insideBounds) {
        pushCursor(null);
        return;
      }

      pushCursor({
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
      });
    };

    const clearCursor = () => {
      pushCursor(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("blur", clearCursor);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", clearCursor);
      clearCursor();
    };
  }, [
    appShellRef,
    collaborationControllerRef,
    collaborationMode,
    lastCollaborationCursorRef,
  ]);

  useEffect(() => {
    collaborationControllerRef.current?.pushState(projectState);
  }, [collaborationControllerRef, projectState]);

  // Shows the top bar "Copied" badge for a few seconds after a copy.
  function showShareCopiedBadge() {
    setHasCopiedShareInvite(true);
    if (shareCopyResetTimeoutRef.current !== null) {
      window.clearTimeout(shareCopyResetTimeoutRef.current);
    }
    shareCopyResetTimeoutRef.current = window.setTimeout(() => {
      setHasCopiedShareInvite(false);
    }, 4500);
  }

  async function handleStartShare() {
    if (typeof window === "undefined" || isStartingShare) {
      return;
    }

    const roomName = collaborationView.pendingShareRoom;
    setIsStartingShare(true);
    setHasCopiedShareInvite(false);
    setShareUrl("");

    try {
      setCollaborationRoom(roomName);
      setCollaborationMode("sharing");

      const { url: inviteUrl, localOnly } = buildPublicShareUrl(
        roomName,
        parseSignalingUrls(collaborationSignaling),
        collaborationPassword,
        {
          origin: window.location.origin,
          pathname: window.location.pathname,
          publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
        },
      );
      // Kept whether or not the copy below works, so the Copy share link
      // buttons can copy it again for the rest of the session.
      setShareUrl(inviteUrl);

      try {
        await navigator.clipboard.writeText(inviteUrl);
        showShareCopiedBadge();
        setStatus(
          localOnly
            ? "Invite copied, but it only works on this computer or network. Share from the deployed app to invite others. Click Stop Share to disconnect."
            : "Public sharing is live. Invite copied. Click Stop Share to disconnect.",
        );
      } catch (error) {
        setStatus(shareCopyFailedStatus(error));
      }

      setIsShareDialogOpen(false);
    } finally {
      setIsStartingShare(false);
    }
  }

  function handleStopShare() {
    collaborationControllerRef.current?.destroy();
    collaborationControllerRef.current = null;
    setCollaborationState(IDLE_COLLABORATION_STATE);
    setCollaborationMode("idle");
    setShareUrl("");
    setStatus("Public sharing stopped. Signaling socket disconnected.");
  }

  function handleDisconnectConnection() {
    forgetJoinedRoom();
    const href = removeInviteParams(window.location.href);
    if (href) {
      window.history.replaceState(window.history.state, "", href);
    }
    collaborationControllerRef.current?.destroy();
    collaborationControllerRef.current = null;
    setCollaborationState(IDLE_COLLABORATION_STATE);
    setCollaborationMode("idle");
    setStatus("Disconnected from the shared collaboration session.");
  }

  async function handleConnectToShare() {
    if (isStartingConnect) {
      return;
    }

    setIsStartingConnect(true);
    try {
      const invite = parseCollaborationInvite(connectInviteValue);
      // Save this browser's own session before the shared one replaces it.
      await flushWorkspaceSession();
      viewingSharedSessionRef.current = true;
      rememberJoinedRoom(invite.room, invite.password);
      window.history.replaceState(
        window.history.state,
        "",
        withJoinedRoom(window.location.href, invite.room, invite.signaling),
      );
      setCollaborationRoom(invite.room);
      setCollaborationSignaling(invite.signaling);
      setCollaborationPassword(invite.password);
      setCollaborationMode("connected");
      setIsConnectDialogOpen(false);
      setConnectInviteValue("");
      setStatus(`Connecting to collaboration room "${invite.room}".`);
    } catch (error) {
      setStatus(
        `Unable to connect with that invite: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsStartingConnect(false);
    }
  }

  return {
    showShareCopiedBadge,
    handleStartShare,
    handleStopShare,
    handleDisconnectConnection,
    handleConnectToShare,
  };
}
