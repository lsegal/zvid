import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { getClipEndQ } from "../app/timeline-math.ts";
import type { ArrangementClip, Lane } from "../app/types.ts";
import {
  type ExportRange,
  moveExportMarker,
  snapExportQ,
  snapToFrame,
} from "../export-options.ts";
import { MainWaveform } from "../MainWaveform";
import type { MediaItem } from "../media";
import type { WaveformPeaks } from "../waveform-peaks";

type ExportRangeTimelineProps = {
  range: ExportRange;
  // The whole session, from 0 to here, in quarter notes.
  totalQ: number;
  playheadQ: number;
  clips: ArrangementClip[];
  lanes: Lane[];
  mediaItems: MediaItem[];
  mainAudioPeaks: WaveformPeaks | undefined;
  bpm: number;
  fps: number;
  beatQ: number;
  // The shortest range, one frame.
  minimumQ: number;
  onRangeChange(range: ExportRange): void;
  onScrub(playheadQ: number): void;
  onScrubbingChange(scrubbing: boolean): void;
};

type Drag = { kind: "in" | "out" | "playhead"; pointerId: number };

// A compact strip of the whole session: the arrangement's layers, the main
// audio's waveform, draggable In and Out markers that dim what's outside
// them, and a playhead to scrub.
export function ExportRangeTimeline({
  range,
  totalQ,
  playheadQ,
  clips,
  lanes,
  mediaItems,
  mainAudioPeaks,
  bpm,
  fps,
  beatQ,
  minimumQ,
  onRangeChange,
  onScrub,
  onScrubbingChange,
}: ExportRangeTimelineProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }
    const observer = new ResizeObserver(() => setWidth(strip.clientWidth));
    observer.observe(strip);
    setWidth(strip.clientWidth);
    return () => observer.disconnect();
  }, []);

  const spanQ = Math.max(totalQ, minimumQ);
  const quarterPx = width > 0 ? width / spanQ : 0;
  const toPx = (q: number) => Math.min(width, Math.max(0, q * quarterPx));
  const inPx = toPx(range.inQ);
  const outPx = toPx(range.outQ);
  const thumbnails = new Map(
    mediaItems.map((item) => [item.id, item.thumbnailUrl]),
  );
  const laneRows = lanes.filter((lane) =>
    clips.some((clip) => clip.laneId === lane.id),
  );

  function pointerQ(event: ReactPointerEvent) {
    const bounds = stripRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) {
      return 0;
    }
    return ((event.clientX - bounds.left) / bounds.width) * spanQ;
  }

  function moveMarker(kind: "in" | "out", q: number, free: boolean) {
    const snapped = Math.min(snapExportQ(q, { beatQ, free, fps, bpm }), spanQ);
    onRangeChange(moveExportMarker(range, kind, snapped, minimumQ));
  }

  function applyDrag(drag: Drag, event: ReactPointerEvent) {
    const q = pointerQ(event);
    if (drag.kind === "playhead") {
      onScrub(Math.min(spanQ, Math.max(0, snapToFrame(q, fps, bpm))));
      return;
    }
    moveMarker(drag.kind, q, event.shiftKey);
  }

  function startDrag(kind: Drag["kind"], event: ReactPointerEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    stripRef.current?.setPointerCapture(event.pointerId);
    const drag = { kind, pointerId: event.pointerId };
    dragRef.current = drag;
    if (kind === "playhead") {
      onScrubbingChange(true);
    }
    applyDrag(drag, event);
  }

  function onPointerMove(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      applyDrag(drag, event);
    }
  }

  function endDrag(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (drag.kind === "playhead") {
      onScrubbingChange(false);
    }
  }

  // Arrow keys move a focused marker a beat, or a frame with Shift.
  function onMarkerKeyDown(
    kind: "in" | "out",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const direction =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? minimumQ : beatQ;
    const from = kind === "in" ? range.inQ : range.outQ;
    moveMarker(kind, from + direction * step, event.shiftKey);
  }

  const marker = (kind: "in" | "out", px: number, label: string) => (
    <div
      aria-label={`${label} marker`}
      aria-valuemax={spanQ}
      aria-valuemin={0}
      aria-valuenow={kind === "in" ? range.inQ : range.outQ}
      className={`export-range__marker export-range__marker--${kind}`}
      data-export-marker={kind}
      onKeyDown={(event) => onMarkerKeyDown(kind, event)}
      onPointerDown={(event) => startDrag(kind, event)}
      role="slider"
      style={{ left: px }}
      tabIndex={0}
      title={`Drag to set ${label} (Shift: frame-accurate)`}
    >
      <span className="export-range__marker-flag">{label}</span>
    </div>
  );

  return (
    <div
      className={`export-range${mainAudioPeaks ? " export-range--audio" : ""}`}
      data-export-range=""
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={(event) => startDrag("playhead", event)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      ref={stripRef}
    >
      <div className="export-range__lanes">
        {laneRows.map((lane) => (
          <div className="export-range__lane" key={lane.id}>
            {clips
              .filter((clip) => clip.laneId === lane.id)
              .map((clip) => {
                const left = toPx(clip.startQ);
                const thumbnail = clip.mediaId
                  ? thumbnails.get(clip.mediaId)
                  : undefined;
                return (
                  <div
                    className="export-range__clip"
                    key={clip.id}
                    style={{
                      left,
                      width: Math.max(1, toPx(getClipEndQ(clip, bpm)) - left),
                      backgroundColor: clip.tint,
                      backgroundImage: thumbnail
                        ? `url("${thumbnail}")`
                        : undefined,
                    }}
                  />
                );
              })}
          </div>
        ))}
      </div>
      {mainAudioPeaks && width > 0 ? (
        <div className="export-range__waveform">
          <MainWaveform
            bpm={bpm}
            peaks={mainAudioPeaks}
            quarterPx={quarterPx}
            visibleStartPx={0}
            visibleWidthPx={width}
          />
        </div>
      ) : null}
      <div className="export-range__dim" style={{ left: 0, width: inPx }} />
      <div
        className="export-range__dim"
        style={{ left: outPx, width: Math.max(0, width - outPx) }}
      />
      <div
        className="export-range__selection"
        style={{ left: inPx, width: Math.max(0, outPx - inPx) }}
      />
      <div
        className="export-range__playhead"
        style={{ left: toPx(playheadQ) }}
      />
      {marker("in", inPx, "In")}
      {marker("out", outPx, "Out")}
    </div>
  );
}
