import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PALETTE, SOURCE_TRACK_DRAG_CLEAR_DELAY_MS } from "../app/constants.ts";
import { formatDuration } from "../app/format.ts";
import { getDropStartQ } from "../app/timeline-math.ts";
import type {
  SourceTrackDragPreview,
  SourceTrackDropTarget,
} from "../app/types.ts";
import {
  buildDraggedMediaKey,
  getDraggedMediaFiles,
  getSourceTrackDragState,
  getSourceTrackDropTarget,
  hasDraggedFileData,
  pluralize,
  revokeObjectUrlIfNeeded,
  stripFilenameExtension,
} from "../app/util.ts";
import { getHarness } from "../harness";
import { isWithinMainAudioDropTarget } from "../main-audio-drop";
import type { MediaItem } from "../media";

export type SourceTrackDropInputs = {
  mediaItems: MediaItem[];
  appShellRef: RefObject<HTMLDivElement | null>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  labelWidth: number;
  quarterPx: number;
  snapUnit: number;
  snapEnabled: boolean;
  setIsMainAudioDropTarget: (isDropTarget: boolean) => void;
  importMediaIntoSourceTrack: (
    files: File[],
    target: SourceTrackDropTarget,
  ) => Promise<void>;
  setStatus: (status: string) => void;
};

const isSameDropTarget = (
  a: SourceTrackDropTarget | null,
  b: SourceTrackDropTarget | null,
) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    a.startQ === b.startQ &&
    (a.kind !== "track" || (b.kind === "track" && a.trackId === b.trackId)));

// Dragging media files over the source tracks: the track under the pointer,
// the snapped timeline position under it where the media will start, the
// preview card of the dragged files, and importing them on drop. One
// window-level listener serves every source track drop target.
export function useSourceTrackDrop({
  mediaItems,
  appShellRef,
  timelineScrollRef,
  labelWidth,
  quarterPx,
  snapUnit,
  snapEnabled,
  setIsMainAudioDropTarget,
  importMediaIntoSourceTrack,
  setStatus,
}: SourceTrackDropInputs) {
  // Media is dragged over the app, whether or not over a drop target.
  const [isSourceTrackFileDragActive, setIsSourceTrackFileDragActive] =
    useState(false);
  const [sourceTrackDragTarget, setSourceTrackDragTarget] =
    useState<SourceTrackDropTarget | null>(null);
  const [sourceTrackDragPreview, setSourceTrackDragPreview] =
    useState<SourceTrackDragPreview | null>(null);
  const sourceTrackDragPreviewRef = useRef<SourceTrackDragPreview | null>(null);
  const sourceTrackDragHideTimeoutRef = useRef<number | null>(null);
  const sourceTrackDragPreviewKeyRef = useRef<string>("");
  const sourceTrackDragPreviewRequestRef = useRef(0);

  const sourceTrackDragPreviewDetail = sourceTrackDragPreview
    ? sourceTrackDragPreview.status === "pending"
      ? "Drop to import"
      : sourceTrackDragPreview.status === "loading"
        ? "Loading clip preview..."
        : sourceTrackDragPreview.status === "error"
          ? sourceTrackDragPreview.fileCount > 1
            ? `${pluralize(sourceTrackDragPreview.fileCount, "file")} ready to import`
            : "Drop to import without a preview"
          : sourceTrackDragPreview.durationSeconds !== undefined
            ? `${sourceTrackDragPreview.kind === "audio" ? "Audio" : "Video"} · ${formatDuration(
                sourceTrackDragPreview.durationSeconds,
              )}`
            : sourceTrackDragPreview.kind === "audio"
              ? "Audio clip"
              : "Media clip"
    : "";
  const sourceTrackDragPreviewOverflow =
    sourceTrackDragPreview &&
    sourceTrackDragPreview.status !== "pending" &&
    sourceTrackDragPreview.fileCount > 1
      ? `+${sourceTrackDragPreview.fileCount - 1} more`
      : null;
  const isNewSourceTrackDropTarget =
    sourceTrackDragTarget?.kind === "new-track";

  const clearSourceTrackDragState = useCallback(() => {
    if (sourceTrackDragHideTimeoutRef.current !== null) {
      window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
      sourceTrackDragHideTimeoutRef.current = null;
    }

    sourceTrackDragPreviewKeyRef.current = "";
    sourceTrackDragPreviewRequestRef.current += 1;
    setSourceTrackDragTarget(null);
    setIsSourceTrackFileDragActive(false);
    setIsMainAudioDropTarget(false);
    setSourceTrackDragPreview((current) => {
      revokeObjectUrlIfNeeded(current?.thumbnailUrl);
      return null;
    });
  }, [setIsMainAudioDropTarget]);

  const scheduleSourceTrackDragClear = useCallback(() => {
    if (sourceTrackDragHideTimeoutRef.current !== null) {
      window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
    }

    sourceTrackDragHideTimeoutRef.current = window.setTimeout(() => {
      sourceTrackDragHideTimeoutRef.current = null;
      clearSourceTrackDragState();
    }, SOURCE_TRACK_DRAG_CLEAR_DELAY_MS);
  }, [clearSourceTrackDragState]);

  const ensureSourceTrackDragPreview = useCallback(
    (files: File[]) => {
      const dragKey = buildDraggedMediaKey(files);
      const nextLabel = stripFilenameExtension(files[0]?.name ?? "Media clip");

      setSourceTrackDragPreview((current) => {
        if (current?.dragKey === dragKey) {
          return current;
        }

        revokeObjectUrlIfNeeded(current?.thumbnailUrl);
        return {
          dragKey,
          fileCount: files.length,
          names: files.map((file) => file.name),
          label: nextLabel,
          status: "loading",
        };
      });

      if (sourceTrackDragPreviewKeyRef.current === dragKey) {
        return;
      }

      sourceTrackDragPreviewKeyRef.current = dragKey;
      const requestId = ++sourceTrackDragPreviewRequestRef.current;

      void (async () => {
        try {
          const [previewItem] = await getHarness().analyzeMedia(
            {
              kind: "files",
              files: [files[0]],
            },
            PALETTE,
            mediaItems.length,
          );
          const thumbnailUrl = previewItem?.thumbnailUrl;

          if (requestId !== sourceTrackDragPreviewRequestRef.current) {
            revokeObjectUrlIfNeeded(thumbnailUrl);
            return;
          }

          setSourceTrackDragPreview((current) => {
            if (!current || current.dragKey !== dragKey) {
              revokeObjectUrlIfNeeded(thumbnailUrl);
              return current;
            }

            if (current.thumbnailUrl !== thumbnailUrl) {
              revokeObjectUrlIfNeeded(current.thumbnailUrl);
            }

            return {
              ...current,
              label: stripFilenameExtension(previewItem.name),
              status: "ready",
              kind: previewItem.kind,
              durationSeconds: previewItem.durationSeconds,
              thumbnailUrl,
            };
          });
        } catch (error) {
          if (requestId !== sourceTrackDragPreviewRequestRef.current) {
            return;
          }

          const message =
            error instanceof Error ? error.message : String(error);
          setSourceTrackDragPreview((current) =>
            current?.dragKey === dragKey
              ? {
                  ...current,
                  status: "error",
                  error: message,
                }
              : current,
          );
        }
      })();
    },
    [mediaItems.length],
  );

  // Most browsers hide the dragged files until drop, exposing only their
  // count and MIME types, so the preview stays generic until then.
  const showPendingSourceTrackDragPreview = useCallback((fileCount: number) => {
    setSourceTrackDragPreview(
      (current) =>
        current ?? {
          dragKey: "",
          fileCount,
          names: [],
          label:
            fileCount === 1
              ? "Media file"
              : fileCount
                ? pluralize(fileCount, "media file")
                : "Media files",
          status: "pending",
        },
    );
  }, []);

  useEffect(() => {
    sourceTrackDragPreviewRef.current = sourceTrackDragPreview;
  }, [sourceTrackDragPreview]);

  useEffect(() => {
    const appShell = appShellRef.current;
    if (!appShell) {
      return;
    }

    const isWithinAppShell = (clientX: number, clientY: number) => {
      const bounds = appShell.getBoundingClientRect();
      return (
        clientX >= bounds.left &&
        clientX <= bounds.right &&
        clientY >= bounds.top &&
        clientY <= bounds.bottom
      );
    };

    // The snapped timeline position under the pointer; Shift skips snapping
    // as it does when moving a clip.
    const getPointerDropTarget = (event: DragEvent) => {
      const timelineScroll = timelineScrollRef.current;
      const startQ = timelineScroll
        ? getDropStartQ(
            event.clientX - timelineScroll.getBoundingClientRect().left,
            timelineScroll.scrollLeft,
            labelWidth,
            quarterPx,
            snapUnit,
            snapEnabled && !event.shiftKey,
          )
        : undefined;
      return getSourceTrackDropTarget(event.target, startQ);
    };

    const handleWindowDrag = (event: DragEvent) => {
      if (
        !hasDraggedFileData(event.dataTransfer) ||
        isWithinMainAudioDropTarget(event.target)
      ) {
        return;
      }

      if (!isWithinAppShell(event.clientX, event.clientY)) {
        scheduleSourceTrackDragClear();
        return;
      }

      // Keep the browser from opening files dropped anywhere in the app, and
      // let drop fire on every source track drop target.
      event.preventDefault();
      event.stopPropagation();
      const target = getPointerDropTarget(event);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = target ? "copy" : "none";
      }

      if (sourceTrackDragHideTimeoutRef.current !== null) {
        window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
        sourceTrackDragHideTimeoutRef.current = null;
      }

      const dragState = getSourceTrackDragState(event.dataTransfer);
      if (dragState.kind !== "accept") {
        setSourceTrackDragTarget(null);
        setIsSourceTrackFileDragActive(false);
        return;
      }

      setSourceTrackDragTarget((current) =>
        isSameDropTarget(current, target) ? current : target,
      );
      setIsSourceTrackFileDragActive(true);
      const files = getDraggedMediaFiles(event.dataTransfer);
      if (files.length) {
        ensureSourceTrackDragPreview(files);
      } else {
        showPendingSourceTrackDragPreview(dragState.fileCount);
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (
        !hasDraggedFileData(event.dataTransfer) ||
        isWithinMainAudioDropTarget(event.target)
      ) {
        return;
      }

      if (!isWithinAppShell(event.clientX, event.clientY)) {
        clearSourceTrackDragState();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearSourceTrackDragState();
      const target = getPointerDropTarget(event);
      if (!target) {
        return;
      }

      const files = getDraggedMediaFiles(event.dataTransfer);
      if (!files.length) {
        setStatus(
          "Only audio and video files can be dropped on source tracks.",
        );
        return;
      }

      void importMediaIntoSourceTrack(files, target);
    };

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!hasDraggedFileData(event.dataTransfer)) {
        return;
      }

      const leavingWindow =
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight;
      if (leavingWindow) {
        event.stopPropagation();
        scheduleSourceTrackDragClear();
      }
    };

    window.addEventListener("dragenter", handleWindowDrag, true);
    window.addEventListener("dragover", handleWindowDrag, true);
    window.addEventListener("dragleave", handleWindowDragLeave, true);
    window.addEventListener("drop", handleWindowDrop, true);

    return () => {
      window.removeEventListener("dragenter", handleWindowDrag, true);
      window.removeEventListener("dragover", handleWindowDrag, true);
      window.removeEventListener("dragleave", handleWindowDragLeave, true);
      window.removeEventListener("drop", handleWindowDrop, true);
    };
  }, [
    appShellRef,
    clearSourceTrackDragState,
    ensureSourceTrackDragPreview,
    importMediaIntoSourceTrack,
    labelWidth,
    quarterPx,
    scheduleSourceTrackDragClear,
    setStatus,
    showPendingSourceTrackDragPreview,
    snapEnabled,
    snapUnit,
    timelineScrollRef,
  ]);

  useEffect(
    () => () => {
      if (sourceTrackDragHideTimeoutRef.current !== null) {
        window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
      }

      revokeObjectUrlIfNeeded(sourceTrackDragPreviewRef.current?.thumbnailUrl);
    },
    [],
  );

  return {
    sourceTrackDragTarget,
    sourceTrackDragPreview,
    isSourceTrackFileDragActive,
    sourceTrackDragPreviewDetail,
    sourceTrackDragPreviewOverflow,
    isNewSourceTrackDropTarget,
    clearSourceTrackDragState,
  };
}
