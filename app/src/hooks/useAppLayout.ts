import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  PREVIEW_MIN_WIDTH,
  PREVIEW_RESIZE_KEY_STEP,
  PREVIEW_WIDTH_STORAGE_KEY,
} from "../app/constants.ts";
import {
  getPreviewMaxWidth,
  readInspectorCollapsed,
  readPreviewWidth,
} from "../app/layout-prefs.ts";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import { clamp } from "../app/util.ts";
import {
  readAudioRowCollapsed,
  writeAudioRowCollapsed,
} from "../audio-row-section.ts";
import { usePrefersReducedMotion } from "../components/MediaSyncSkeleton";
import {
  NO_ROW_HEIGHTS,
  type RowHeights,
  type RowKind,
  toggleRowCollapsed,
} from "../row-heights.ts";
import {
  isSourceTracksSectionCollapsed,
  readSourceTracksCollapsed,
  writeSourceTracksCollapsed,
} from "../source-tracks-section.ts";
import { useLabelResize } from "./useLabelResize.ts";

export type AppLayoutInputs = {
  sourceTrackCount: number;
};

// The editor's layout preferences: the FX panel's collapsed state, the
// source tracks section, the Audio row, each row's height, the track label width, and the preview width with
// its resize handle. Also the platform's shortcut labels and the reduced
// motion preference.
export function useAppLayout({ sourceTrackCount }: AppLayoutInputs) {
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(
    readInspectorCollapsed,
  );
  const [sourceTracksCollapsedPref, setSourceTracksCollapsedPref] = useState(
    () =>
      readSourceTracksCollapsed(
        typeof window === "undefined" ? undefined : window.localStorage,
      ),
  );
  const [isAudioRowCollapsed, setAudioRowCollapsedPref] = useState(() =>
    readAudioRowCollapsed(
      typeof window === "undefined" ? undefined : window.localStorage,
    ),
  );
  const [rowHeights, setRowHeights] = useState<RowHeights>(NO_ROW_HEIGHTS);
  const labelResize = useLabelResize();
  const { labelWidth } = labelResize;
  const [previewWidth, setPreviewWidth] = useState(readPreviewWidth);
  const [editorGridWidth, setEditorGridWidth] = useState(0);
  const [mediaDrawerWidth, setMediaDrawerWidth] = useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();
  const editorGridRef = useRef<HTMLDivElement | null>(null);
  const previewResizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const isSourceTracksCollapsed = isSourceTracksSectionCollapsed(
    sourceTracksCollapsedPref,
    sourceTrackCount,
  );
  const setSourceTracksCollapsed = useCallback((collapsed: boolean) => {
    setSourceTracksCollapsedPref(collapsed);
    writeSourceTracksCollapsed(window.localStorage, collapsed);
  }, []);
  const setAudioRowCollapsed = useCallback((collapsed: boolean) => {
    setAudioRowCollapsedPref(collapsed);
    writeAudioRowCollapsed(window.localStorage, collapsed);
  }, []);
  const toggleRowCollapsedById = useCallback((kind: RowKind, id: string) => {
    setRowHeights((heights) => toggleRowCollapsed(heights, kind, id));
  }, []);

  const shortcutLabels = useMemo(() => getShortcutLabels(), []);
  // Until the grid is measured the saved width stands; after that it shrinks
  // to fit while the saved preference stays as it was.
  const measuredPreviewMaxWidth = getPreviewMaxWidth(
    editorGridWidth,
    labelWidth,
    mediaDrawerWidth,
  );
  const previewMaxWidth = Number.isFinite(measuredPreviewMaxWidth)
    ? measuredPreviewMaxWidth
    : previewWidth;
  const effectivePreviewWidth = Math.min(previewWidth, previewMaxWidth);

  useEffect(() => {
    const editorGrid = editorGridRef.current;
    if (!editorGrid) {
      return;
    }

    // The Media drawer's column (drawer plus its resize handle) is the grid's
    // other column, and it changes width without the grid resizing.
    const mediaDrawerColumn = editorGrid.querySelector<HTMLElement>(
      ".media-drawer-column",
    );
    const measure = () => {
      setEditorGridWidth(editorGrid.clientWidth);
      setMediaDrawerWidth(mediaDrawerColumn?.offsetWidth ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(editorGrid);
    if (mediaDrawerColumn) {
      observer.observe(mediaDrawerColumn);
    }
    return () => observer.disconnect();
  }, []);

  function toggleInspectorCollapsed() {
    const nextCollapsed = !isInspectorCollapsed;
    setIsInspectorCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(
        INSPECTOR_COLLAPSED_STORAGE_KEY,
        String(nextCollapsed),
      );
    } catch {
      // Storage can be unavailable (private mode, quota); the toggle still works.
    }
  }

  function commitPreviewWidth(nextWidth: number) {
    const width = clamp(
      Math.round(nextWidth),
      PREVIEW_MIN_WIDTH,
      previewMaxWidth,
    );
    setPreviewWidth(width);
    try {
      window.localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Storage can be unavailable (private mode, quota); resizing still works.
    }
  }

  function handlePreviewResizePointerDown(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: effectivePreviewWidth,
    };
  }

  function handlePreviewResizePointerMove(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    const resize = previewResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) {
      return;
    }

    // The panel sits to the right of the handle, so dragging left widens it.
    commitPreviewWidth(resize.startWidth + resize.startX - event.clientX);
  }

  function handlePreviewResizePointerEnd(
    event: ReactPointerEvent<HTMLHRElement>,
  ) {
    if (previewResizeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    previewResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePreviewResizeKeyDown(
    event: ReactKeyboardEvent<HTMLHRElement>,
  ) {
    let nextWidth: number;
    switch (event.key) {
      case "ArrowLeft":
        nextWidth = effectivePreviewWidth + PREVIEW_RESIZE_KEY_STEP;
        break;
      case "ArrowRight":
        nextWidth = effectivePreviewWidth - PREVIEW_RESIZE_KEY_STEP;
        break;
      case "Home":
        nextWidth = PREVIEW_MIN_WIDTH;
        break;
      case "End":
        nextWidth = previewMaxWidth;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitPreviewWidth(nextWidth);
  }

  return {
    isInspectorCollapsed,
    toggleInspectorCollapsed,
    isSourceTracksCollapsed,
    setSourceTracksCollapsed,
    isAudioRowCollapsed,
    setAudioRowCollapsed,
    rowHeights,
    toggleRowCollapsed: toggleRowCollapsedById,
    labelResize,
    labelWidth,
    prefersReducedMotion,
    shortcutLabels,
    editorGridRef,
    editorGridWidth,
    previewMaxWidth,
    effectivePreviewWidth,
    commitPreviewWidth,
    handlePreviewResizePointerDown,
    handlePreviewResizePointerMove,
    handlePreviewResizePointerEnd,
    handlePreviewResizeKeyDown,
  };
}

export type AppLayout = ReturnType<typeof useAppLayout>;
