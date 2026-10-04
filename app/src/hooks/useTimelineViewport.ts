import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BASE_QUARTER_PX,
  GRID_LINE_COLORS,
  SIGNATURES,
} from "../app/constants.ts";
import { patchProjectState } from "../app/session-project.ts";
import { getClipDurationQ, getSelectionEndQ } from "../app/timeline-math.ts";
import type {
  ArrangementClip,
  ProjectState,
  SourceSpan,
  TimelineSelection,
  TimelineViewport,
} from "../app/types.ts";
import { clamp } from "../app/util.ts";
import { getFilmstripRange } from "../clip-filmstrip.ts";
import {
  divisionQuarters,
  type GridDivision,
  getBarStep,
  getRulerBars,
  getGridLayers,
  RULER_LABEL_MIN_PX,
  resolveAdaptiveDivision,
} from "../timeline-grid";

export type TimelineViewportInputs = {
  zoom: number;
  signatureId: ProjectState["signatureId"];
  timelineMode: ProjectState["timelineMode"];
  bpm: number;
  timelineClips: ArrangementClip[];
  sourceSpans: SourceSpan[];
  pendingSelection: TimelineSelection | null;
  // The end of the clips being recorded, which aren't source spans yet.
  recordingEndQ?: number;
  labelWidth: number;
  playheadQRef: { current: number };
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  arrangementLanesRef: RefObject<HTMLDivElement | null>;
  commitViewChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
};

// The timeline's zoom, grid and scroll position: the pixels per quarter, the
// grid and snap units, the ruler bars and the visible range.
export function useTimelineViewport({
  zoom,
  signatureId,
  timelineMode,
  bpm,
  timelineClips,
  sourceSpans,
  pendingSelection,
  recordingEndQ = 0,
  labelWidth,
  playheadQRef,
  timelineScrollRef,
  arrangementLanesRef,
  commitViewChange,
}: TimelineViewportInputs) {
  const [timelineViewport, setTimelineViewport] = useState<TimelineViewport>({
    scrollLeft: 0,
    clientWidth: 0,
    clientHeight: 0,
    lanesTop: 0,
  });
  const [zoomDraft, setZoomDraft] = useState<number | null>(null);
  const zoomDraftRef = useRef<number | null>(null);
  const resolvedZoom = zoomDraft ?? zoom;

  const updateZoomDraft = useCallback((nextZoom: number | null) => {
    zoomDraftRef.current = nextZoom;
    setZoomDraft(nextZoom);
  }, []);

  const signature =
    SIGNATURES.find((candidate) => candidate.id === signatureId) ??
    SIGNATURES[0];
  const beatUnit = 4 / signature.denominator;
  const barLength = signature.numerator * beatUnit;
  const quarterPx = BASE_QUARTER_PX * resolvedZoom;
  // Resolved from the last division so the grid keeps it while zooming within
  // the thresholds instead of flickering between two divisions.
  const [lastAdaptiveDivision, setLastAdaptiveDivision] =
    useState<GridDivision>(() => resolveAdaptiveDivision(quarterPx));
  const adaptiveDivision = resolveAdaptiveDivision(
    quarterPx,
    lastAdaptiveDivision,
  );
  if (adaptiveDivision !== lastAdaptiveDivision) {
    setLastAdaptiveDivision(adaptiveDivision);
  }
  // Snapping and the grid both follow the zoom-adaptive division.
  const snapUnit = divisionQuarters(adaptiveDivision);
  const gridUnit = snapUnit;
  const totalQuarters = useMemo(() => {
    let nextTotalQuarters = barLength * 12;
    for (const clip of timelineClips) {
      nextTotalQuarters = Math.max(
        nextTotalQuarters,
        clip.startQ + getClipDurationQ(clip, bpm) + barLength,
      );
    }
    for (const span of sourceSpans) {
      nextTotalQuarters = Math.max(
        nextTotalQuarters,
        span.startQ + getClipDurationQ(span, bpm) + barLength,
      );
    }
    if (pendingSelection) {
      nextTotalQuarters = Math.max(
        nextTotalQuarters,
        getSelectionEndQ(pendingSelection) + barLength,
      );
    }
    if (recordingEndQ) {
      nextTotalQuarters = Math.max(
        nextTotalQuarters,
        recordingEndQ + barLength,
      );
    }

    return nextTotalQuarters;
  }, [
    barLength,
    bpm,
    pendingSelection,
    recordingEndQ,
    sourceSpans,
    timelineClips,
  ]);
  const timelineWidth = totalQuarters * quarterPx;
  const gridStyle = useMemo(() => {
    // CSS paints the first layer on top, so the strongest lines go first.
    const layers = getGridLayers(gridUnit, signature, quarterPx).reverse();
    return {
      backgroundImage: layers
        .map(
          (layer) =>
            `linear-gradient(to right, ${GRID_LINE_COLORS[layer.weight]} 1px, transparent 1px)`,
        )
        .join(", "),
      backgroundSize: layers
        .map((layer) => `${layer.spacingQ * quarterPx}px 100%`)
        .join(", "),
    };
  }, [gridUnit, quarterPx, signature]);
  // Zoomed far out, only every 2nd, 4th, 8th... bar is labeled.
  const rulerLabelBarStep = getBarStep(
    barLength * quarterPx,
    RULER_LABEL_MIN_PX[timelineMode],
  );
  const visibleTimelineStartPx = Math.max(0, timelineViewport.scrollLeft);
  const visibleTimelineWidthPx = Math.max(
    0,
    timelineViewport.clientWidth - labelWidth,
  );
  const visibleTimelineEndPx = visibleTimelineStartPx + visibleTimelineWidthPx;
  const filmstripRange = getFilmstripRange(
    visibleTimelineStartPx,
    visibleTimelineWidthPx,
  );
  const filmstripRangeStartPx = filmstripRange.startPx;
  const filmstripRangeEndPx = filmstripRange.endPx;
  // The bars across the same range: it reaches a block past either side of
  // the view and only moves a block at a time, so scrolling within a block
  // keeps the same bars.
  const rulerBars = useMemo(
    () =>
      getRulerBars(
        barLength,
        totalQuarters,
        quarterPx,
        filmstripRangeStartPx,
        filmstripRangeEndPx,
      ),
    [
      barLength,
      filmstripRangeEndPx,
      filmstripRangeStartPx,
      quarterPx,
      totalQuarters,
    ],
  );

  const syncTimelineViewport = useCallback(() => {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return;
    }

    setTimelineViewport({
      scrollLeft: timelineScroll.scrollLeft,
      clientWidth: timelineScroll.clientWidth,
      clientHeight: timelineScroll.clientHeight,
      lanesTop: arrangementLanesRef.current?.offsetTop ?? 0,
    });
  }, [arrangementLanesRef, timelineScrollRef]);

  const flushZoomDraft = useCallback(
    (label = "Adjust zoom") => {
      const pendingZoom = zoomDraftRef.current;
      updateZoomDraft(null);
      if (pendingZoom === null || Math.abs(pendingZoom - zoom) <= 0.0001) {
        return;
      }

      commitViewChange(label, (current) =>
        patchProjectState(current, { zoom: pendingZoom }),
      );
    },
    [commitViewChange, zoom, updateZoomDraft],
  );

  const setZoomValue = useCallback(
    (label: string, nextZoom: number) => {
      updateZoomDraft(null);
      if (Math.abs(nextZoom - zoom) <= 0.0001) {
        return;
      }

      commitViewChange(label, (current) =>
        patchProjectState(current, { zoom: nextZoom }),
      );
    },
    [commitViewChange, zoom, updateZoomDraft],
  );

  function scrollTimelineToPlayhead() {
    const timelineScroll = timelineScrollRef.current;
    if (!timelineScroll) {
      return;
    }

    const playheadPx =
      labelWidth + Math.round(playheadQRef.current * quarterPx);
    const targetLeft = clamp(
      playheadPx - timelineScroll.clientWidth / 2,
      0,
      Math.max(0, labelWidth + timelineWidth - timelineScroll.clientWidth),
    );

    timelineScroll.scrollTo({
      left: targetLeft,
      behavior: "smooth",
    });
  }

  useEffect(() => {
    syncTimelineViewport();

    const handleResize = () => syncTimelineViewport();
    window.addEventListener("resize", handleResize);
    // Panel and preview resizes change the timeline's size without a window
    // resize.
    const observer = new ResizeObserver(handleResize);
    if (timelineScrollRef.current) {
      observer.observe(timelineScrollRef.current);
    }
    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [syncTimelineViewport, timelineScrollRef]);

  return {
    timelineViewport,
    resolvedZoom,
    updateZoomDraft,
    flushZoomDraft,
    setZoomValue,
    signature,
    beatUnit,
    barLength,
    quarterPx,
    snapUnit,
    totalQuarters,
    timelineWidth,
    gridStyle,
    rulerBars,
    rulerLabelBarStep,
    visibleTimelineStartPx,
    visibleTimelineWidthPx,
    visibleTimelineEndPx,
    filmstripRangeStartPx,
    filmstripRangeEndPx,
    syncTimelineViewport,
    scrollTimelineToPlayhead,
  };
}
