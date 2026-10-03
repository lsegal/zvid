import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clampMediaDrawerWidth,
  clampThumbnailSize,
  getMediaDrawerMaxWidth,
  MEDIA_DRAWER_DEFAULT_WIDTH,
  MEDIA_DRAWER_MIN_WIDTH,
  MEDIA_DRAWER_RESIZE_KEY_STEP,
  MEDIA_DRAWER_STORAGE_KEY,
  type MediaDrawerPrefs,
  type MediaDrawerTab,
  type MediaDrawerView,
  parseMediaDrawerPrefs,
  selectMediaDrawerTab,
} from "../components/media/media-drawer-model.ts";

function readMediaDrawerPrefs() {
  try {
    return parseMediaDrawerPrefs(
      window.localStorage.getItem(MEDIA_DRAWER_STORAGE_KEY),
    );
  } catch {
    return parseMediaDrawerPrefs(null);
  }
}

export type MediaDrawerInputs = {
  editorGridWidth: number;
};

// The Media drawer's per-viewer preferences (open, width, tab, view,
// thumbnail size, details pane expanded) persisted to localStorage, its
// resize handle, its search query and the selected media.
export function useMediaDrawer({ editorGridWidth }: MediaDrawerInputs) {
  const [prefs, setPrefs] = useState<MediaDrawerPrefs>(readMediaDrawerPrefs);
  const [query, setQuery] = useState("");
  const [selectedMediaId, setSelectedMediaId] = useState<string>();
  const [isResizing, setIsResizing] = useState(false);
  // Opening the Record tab asks for camera and mic access, so a Record tab
  // restored on load waits until the user opens it again or picks a device.
  const [recordRequested, setRecordRequested] = useState(false);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const maxWidth = getMediaDrawerMaxWidth(editorGridWidth);
  const effectiveWidth = clampMediaDrawerWidth(prefs.width, maxWidth);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        MEDIA_DRAWER_STORAGE_KEY,
        JSON.stringify(prefs),
      );
    } catch {
      // Storage can be unavailable (private mode, quota); the drawer still works.
    }
  }, [prefs]);

  const setOpen = useCallback((open: boolean) => {
    setPrefs((current) => ({ ...current, open }));
  }, []);
  // The toolbar's Media | Record switch opens, switches or closes the drawer.
  const selectTab = useCallback((tab: MediaDrawerTab) => {
    if (tab === "record") {
      setRecordRequested(true);
    }
    setPrefs((current) => selectMediaDrawerTab(current, tab));
  }, []);
  const setView = useCallback((view: MediaDrawerView) => {
    setPrefs((current) => ({ ...current, view }));
  }, []);
  const setThumbnailSize = useCallback((size: number) => {
    setPrefs((current) => ({
      ...current,
      thumbnailSize: clampThumbnailSize(size),
    }));
  }, []);

  const toggleDetailsOpen = useCallback(() => {
    setPrefs((current) => ({ ...current, detailsOpen: !current.detailsOpen }));
  }, []);

  function commitWidth(nextWidth: number) {
    const width = clampMediaDrawerWidth(nextWidth, maxWidth);
    setPrefs((current) => ({ ...current, width }));
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLHRElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: effectiveWidth,
    };
    setIsResizing(true);
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLHRElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }

    // The drawer sits to the left of the handle, so dragging right widens it.
    commitWidth(resize.startWidth + event.clientX - resize.startX);
  }

  function handleResizePointerEnd(event: ReactPointerEvent<HTMLHRElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    resizeRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLHRElement>) {
    let nextWidth: number;
    switch (event.key) {
      case "ArrowRight":
        nextWidth = effectiveWidth + MEDIA_DRAWER_RESIZE_KEY_STEP;
        break;
      case "ArrowLeft":
        nextWidth = effectiveWidth - MEDIA_DRAWER_RESIZE_KEY_STEP;
        break;
      case "Home":
        nextWidth = MEDIA_DRAWER_MIN_WIDTH;
        break;
      case "End":
        nextWidth = maxWidth;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitWidth(nextWidth);
  }

  return {
    isOpen: prefs.open,
    setOpen,
    tab: prefs.tab,
    selectTab,
    recordRequested,
    requestRecordInputs: () => setRecordRequested(true),
    view: prefs.view,
    setView,
    thumbnailSize: prefs.thumbnailSize,
    setThumbnailSize,
    detailsOpen: prefs.detailsOpen,
    toggleDetailsOpen,
    width: effectiveWidth,
    minWidth: MEDIA_DRAWER_MIN_WIDTH,
    maxWidth,
    isResizing,
    resetWidth: () => commitWidth(MEDIA_DRAWER_DEFAULT_WIDTH),
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerEnd,
    handleResizeKeyDown,
    query,
    setQuery,
    // Shown in the details pane and previewed in the Media tab.
    selectedMediaId,
    setSelectedMediaId,
  };
}

export type MediaDrawerState = ReturnType<typeof useMediaDrawer>;
