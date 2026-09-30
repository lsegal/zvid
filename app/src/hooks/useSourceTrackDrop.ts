import {
  type DragEvent as ReactDragEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PALETTE, SOURCE_TRACK_DRAG_CLEAR_DELAY_MS } from "../app/constants.ts";
import { formatDuration } from "../app/format.ts";
import type {
  SourceTrack,
  SourceTrackDragPreview,
  SourceTrackDropTarget,
} from "../app/types.ts";
import {
  buildDraggedMediaKey,
  getDraggedMediaFiles,
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
  sourceTracks: SourceTrack[];
  appShellRef: RefObject<HTMLDivElement | null>;
  setIsMainAudioDropTarget: (isDropTarget: boolean) => void;
  importMediaIntoSourceTrack: (
    files: File[],
    target: SourceTrackDropTarget,
  ) => Promise<void>;
};

// Dragging media files over the source tracks: the track under the pointer,
// the preview card of the dragged files, and importing them on drop.
export function useSourceTrackDrop({
  mediaItems,
  sourceTracks,
  appShellRef,
  setIsMainAudioDropTarget,
  importMediaIntoSourceTrack,
}: SourceTrackDropInputs) {
  const [sourceTrackDragTarget, setSourceTrackDragTarget] =
    useState<SourceTrackDropTarget | null>(null);
  const [sourceTrackDragPreview, setSourceTrackDragPreview] =
    useState<SourceTrackDragPreview | null>(null);
  const sourceTrackDragPreviewRef = useRef<SourceTrackDragPreview | null>(null);
  const sourceTrackDragHideTimeoutRef = useRef<number | null>(null);
  const sourceTrackDragPreviewKeyRef = useRef<string>("");
  const sourceTrackDragPreviewRequestRef = useRef(0);

  const isSourceTrackFileDragActive = Boolean(sourceTrackDragTarget);
  const sourceTrackDragPreviewDetail = sourceTrackDragPreview
    ? sourceTrackDragPreview.status === "loading"
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
    sourceTrackDragPreview && sourceTrackDragPreview.fileCount > 1
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

  const handleSourceTrackDragEvent = useCallback(
    (event: ReactDragEvent<HTMLElement>, target: SourceTrackDropTarget) => {
      const files = getDraggedMediaFiles(event.dataTransfer);
      if (!files.length) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";

      if (sourceTrackDragHideTimeoutRef.current !== null) {
        window.clearTimeout(sourceTrackDragHideTimeoutRef.current);
        sourceTrackDragHideTimeoutRef.current = null;
      }

      setSourceTrackDragTarget(target);
      ensureSourceTrackDragPreview(files);
    },
    [ensureSourceTrackDragPreview],
  );

  const resolveSourceTrackDropTargetAtPoint = useCallback(
    (clientX: number, clientY: number): SourceTrackDropTarget | null => {
      const element = document.elementFromPoint(clientX, clientY);
      const target = element?.closest<HTMLElement>(
        "[data-source-track-drop-target]",
      );
      const targetKind = target?.dataset.sourceTrackDropTarget;
      if (targetKind === "track" && target?.dataset.sourceTrackId) {
        return {
          kind: "track",
          trackId: target.dataset.sourceTrackId,
        };
      }

      if (targetKind === "new-track") {
        return { kind: "new-track" };
      }

      return sourceTracks.length ? { kind: "new-track" } : null;
    },
    [sourceTracks.length],
  );

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

      event.preventDefault();
      event.stopPropagation();
      const target = resolveSourceTrackDropTargetAtPoint(
        event.clientX,
        event.clientY,
      );
      if (target) {
        setSourceTrackDragTarget(target);
      }

      const files = getDraggedMediaFiles(event.dataTransfer);
      if (files.length) {
        ensureSourceTrackDragPreview(files);
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
      const files = getDraggedMediaFiles(event.dataTransfer);
      if (!files.length) {
        clearSourceTrackDragState();
        return;
      }

      const target = resolveSourceTrackDropTargetAtPoint(
        event.clientX,
        event.clientY,
      ) ?? {
        kind: "new-track" as const,
      };
      clearSourceTrackDragState();
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
    resolveSourceTrackDropTargetAtPoint,
    scheduleSourceTrackDragClear,
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
    scheduleSourceTrackDragClear,
    handleSourceTrackDragEvent,
  };
}
