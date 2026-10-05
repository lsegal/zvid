import { type Dispatch, memo, type SetStateAction } from "react";
import { type Filmstrip, getClipPieceKey } from "../../app/filmstrip.ts";
import { formatDuration } from "../../app/format.ts";
import type { getShortcutLabels } from "../../app/shortcut-labels.ts";
import { getClipDurationQ } from "../../app/timeline-math.ts";
import type {
  ArrangementClip,
  DragState,
  TimelineSelection,
  TimeSignature,
} from "../../app/types.ts";
import { isClipJumpPress } from "../../clip-jump.ts";
import {
  describeClipMediaState,
  formatClipMediaState,
} from "../../clip-media-state";
import { getClipWaveformKind } from "../../clip-waveform.ts";
import { isContextMenuPress } from "../../context-menu.ts";
import { isFillClip } from "../../fill-clip.ts";
import {
  formatCssColor,
  formatFillPaintCss,
  resolveFillPaint,
} from "../../fill-paint.ts";
import { describeFxClip, isFxClip } from "../../fx-clip.ts";
import { clipEffectTrackId, type SessionEffect } from "../../fx-stack";
import { useAudioClipPeaks } from "../../hooks/useAudioClipPeaks.ts";
import type { usePreviewEditing } from "../../hooks/usePreviewEditing.ts";
import type { MediaItem } from "../../media";
import type { useMenus } from "../../menus/useMenus.ts";
import {
  describeMediaSync,
  formatMediaSyncLabel,
  getMediaSyncClassName,
  type RemoteMediaProgressMap,
} from "../../remote-media-sync.ts";
import { isTextClip } from "../../text-clip.ts";
import { getTextPreview, resolveTextStyle } from "../../text-style.ts";
import {
  getClipThumbnailTimeSeconds,
  getThumbnailCacheKey,
  type ThumbnailSnapshot,
} from "../../thumbnail-cache.ts";
import { formatMusicalPosition } from "../../timeline-format.ts";
import { getVisibleClipSlice } from "../../waveform-range.ts";
import { MediaSyncSkeleton } from "../MediaSyncSkeleton";
import { ClipPieceMedia } from "./ClipPieceMedia";
import "./clip-card.css";

// What every clip card in the arrangement shares.
export type ClipCardContext = {
  selectedClipId: string | undefined;
  dragState: DragState | null;
  bpm: number;
  quarterPx: number;
  visibleTimelineStartPx: number;
  visibleTimelineWidthPx: number;
  signature: TimeSignature;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  thumbnails: ThumbnailSnapshot;
  // Each media clip's pieces, one per source clip in its source track
  // window (see source-track-content.ts), and their filmstrips by
  // getClipPieceKey.
  clipPieces: ReadonlyMap<string, ArrangementClip[]>;
  clipFilmstrips: ReadonlyMap<string, Filmstrip>;
  remoteMediaProgress: RemoteMediaProgressMap;
  // The stacks as drawn, with a Ctrl/Cmd-drag duplicate's copied stack.
  timelineEffects: SessionEffect[];
  effects: SessionEffect[];
  prefersReducedMotion: boolean;
  revealedMediaIds: ReadonlySet<string>;
  shortcutLabels: ReturnType<typeof getShortcutLabels>;
  openArrangementClipMenu: ReturnType<
    typeof useMenus
  >["openArrangementClipMenu"];
  startTextEdit: ReturnType<typeof usePreviewEditing>["startTextEdit"];
  setPendingSelection: Dispatch<SetStateAction<TimelineSelection | null>>;
  setDragPreviewClips: Dispatch<SetStateAction<ArrangementClip[] | null>>;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
};

type ClipCardProps = {
  clip: ArrangementClip;
  // In a collapsed lane: a plain bar with its name, without frames or
  // waveforms.
  collapsed?: boolean;
} & ClipCardContext;

// An arrangement clip: its body, which selects, moves or Ctrl/Cmd-drags a
// duplicate, the trim handles either side, and its fill, text or FX badge,
// media sync skeleton, and the filmstrip and waveform of each piece of its
// source track window, with nothing over the parts that hold no source
// clip.
export const ClipCard = memo(function ClipCard({
  clip,
  collapsed = false,
  selectedClipId,
  dragState,
  bpm,
  quarterPx,
  visibleTimelineStartPx,
  visibleTimelineWidthPx,
  signature,
  mediaItemsById,
  thumbnails,
  clipPieces,
  clipFilmstrips,
  remoteMediaProgress,
  timelineEffects,
  effects,
  prefersReducedMotion,
  revealedMediaIds,
  shortcutLabels,
  openArrangementClipMenu,
  startTextEdit,
  setPendingSelection,
  setDragPreviewClips,
  setSelectedClipId,
  setDragState,
}: ClipCardProps) {
  const selected = clip.id === selectedClipId;
  // Keeps the trimmed edge's handle shown while the pointer
  // strays off it mid-drag.
  const trimming =
    (dragState?.kind === "resize-start" || dragState?.kind === "resize-end") &&
    dragState.clipId === clip.id;
  const trimmingStart = trimming && dragState?.kind === "resize-start";
  const trimmingEnd = trimming && dragState?.kind === "resize-end";
  const durationQ = getClipDurationQ(clip, bpm);
  // The clip's media fields describe its first source clip, which the card
  // reports the state of.
  const media = clip.mediaId ? mediaItemsById.get(clip.mediaId) : undefined;
  const mediaState = describeClipMediaState(clip, media?.availability);
  const pieces = clipPieces.get(clip.id) ?? [];
  // The first frame it shows, when it starts with one and has no filmstrip.
  const firstPiece = pieces[0];
  const firstPieceMedia = firstPiece?.mediaId
    ? mediaItemsById.get(firstPiece.mediaId)
    : undefined;
  const thumbnailUrl =
    !collapsed &&
    firstPiece &&
    firstPiece.startQ === clip.startQ &&
    firstPieceMedia?.hasVideo &&
    describeClipMediaState(firstPiece, firstPieceMedia.availability) ===
      "online"
      ? (thumbnails.get(
          getThumbnailCacheKey(
            firstPieceMedia.id,
            getClipThumbnailTimeSeconds(
              firstPiece,
              firstPieceMedia.durationSeconds,
              bpm,
            ),
            clipFilmstrips.get(getClipPieceKey(clip.id, 0))?.size,
          ),
          `clip:${getClipPieceKey(clip.id, 0)}`,
        ) ?? firstPieceMedia.thumbnailUrl)
      : undefined;
  const filmstrip = pieces.some((_, index) =>
    clipFilmstrips.has(getClipPieceKey(clip.id, index)),
  );
  const mediaSync = media
    ? describeMediaSync(remoteMediaProgress.get(media.id), media.availability)
    : null;
  // Audio-only media draws its waveform, like the Audio lane, until its peaks
  // turn out to be missing. Video with audio overlays it on the frames once
  // its peaks are ready, decoding only while the clip is in view. Each piece
  // draws its own (ClipPieceMedia); the card takes its look from its first
  // source clip's.
  const waveformKind =
    pieces.length && !collapsed
      ? getClipWaveformKind(clip, media, mediaState)
      : "none";
  const inView = getVisibleClipSlice(
    clip.startQ * quarterPx,
    durationQ * quarterPx,
    visibleTimelineStartPx,
    visibleTimelineWidthPx,
  );
  const audioPeaks = useAudioClipPeaks(
    media,
    waveformKind === "overlay" && !inView ? "none" : waveformKind,
  );
  const audio =
    !mediaSync && waveformKind === "audio" && audioPeaks.status !== "none";
  const waveformOverlay =
    !mediaSync && waveformKind === "overlay" && audioPeaks.status === "ready";
  // As the compositor draws it: the clip's own
  // Color or Text first, else its layer's.
  const fillBackground = isFillClip(clip)
    ? formatFillPaintCss(
        resolveFillPaint(
          timelineEffects,
          clip.laneId,
          clipEffectTrackId(clip.id),
        ),
      )
    : undefined;
  const textStyle = isTextClip(clip)
    ? resolveTextStyle(timelineEffects, clip.laneId, clipEffectTrackId(clip.id))
    : undefined;
  const fxLabel = isFxClip(clip) ? describeFxClip(effects, clip.id) : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click is a pointer shortcut; the context-menu key and Shift+F10 open the same menu on the selected clip
    <div
      className={`clip-card ${selected ? "clip-card--selected" : ""} ${trimming ? "clip-card--trimming" : ""} ${filmstrip || fillBackground ? "clip-card--filmstrip" : ""} ${fillBackground ? "clip-card--fill" : ""} ${textStyle ? "clip-card--text" : ""} ${fxLabel ? "clip-card--fx" : ""} ${audio ? "clip-card--audio" : ""} ${waveformOverlay ? "clip-card--waveform-overlay" : ""} ${audio && audioPeaks.status === "loading" && !prefersReducedMotion ? "is-syncing--animated" : ""} ${mediaSync ? getMediaSyncClassName(mediaSync, prefersReducedMotion) : ""} ${media && revealedMediaIds.has(media.id) ? "is-sync-revealed" : ""}`}
      data-clip-id={clip.id}
      onContextMenu={(event) => openArrangementClipMenu(event, clip)}
      onPointerDown={(event) => {
        // Right-click, or Ctrl-click on macOS, selects through the
        // menu instead of starting a drag or a lane selection.
        if (isContextMenuPress(event, shortcutLabels.mac)) {
          event.stopPropagation();
        }
      }}
      style={{
        left: clip.startQ * quarterPx,
        width: durationQ * quarterPx,
        ["--clip-accent" as string]: clip.accent,
        backgroundColor: clip.tint,
        // The audio variant's border follows hover in CSS.
        borderColor: audio ? undefined : clip.accent,
        opacity: mediaState === "online" || mediaSync ? 1 : 0.62,
      }}
    >
      {mediaSync ? <MediaSyncSkeleton variant="clip" view={mediaSync} /> : null}
      {fillBackground ? (
        <span
          aria-hidden="true"
          className="clip-card__fill"
          style={{ background: fillBackground }}
        />
      ) : null}
      {(collapsed ? [] : pieces).map((piece, index) => (
        <ClipPieceMedia
          key={getClipPieceKey(clip.id, index)}
          piece={piece}
          pieceKey={getClipPieceKey(clip.id, index)}
          clipStartQ={clip.startQ}
          bpm={bpm}
          quarterPx={quarterPx}
          visibleTimelineStartPx={visibleTimelineStartPx}
          visibleTimelineWidthPx={visibleTimelineWidthPx}
          mediaItemsById={mediaItemsById}
          thumbnails={thumbnails}
          clipFilmstrips={clipFilmstrips}
          remoteMediaProgress={remoteMediaProgress}
        />
      ))}
      <button
        className={`clip-card__handle clip-card__handle--start${trimmingStart ? " clip-card__handle--trimming" : ""}`}
        onPointerDown={(event) => {
          if (isContextMenuPress(event, shortcutLabels.mac)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          setPendingSelection(null);
          setDragPreviewClips(null);
          setSelectedClipId(clip.id);
          setDragState({
            kind: "resize-start",
            pointerId: event.pointerId,
            clipId: clip.id,
            pointerStartX: event.clientX,
            originStartQ: clip.startQ,
            originDurationQ: durationQ,
          });
        }}
        type="button"
      />
      <button
        className="clip-card__body"
        onClick={() => {
          setPendingSelection(null);
          // Selecting never moves the playhead.
          setSelectedClipId(clip.id);
        }}
        // Double-clicking a text clip types on it in
        // the preview.
        title={`${shortcutLabels.clipJump} to jump to start`}
        onDoubleClick={textStyle ? () => startTextEdit(clip.id) : undefined}
        onPointerDown={(event) => {
          if (isContextMenuPress(event, shortcutLabels.mac)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          setPendingSelection(null);
          setDragPreviewClips(null);
          const duplicateOnDrag = event.ctrlKey || event.metaKey;
          const dragClipId = duplicateOnDrag
            ? `window-${crypto.randomUUID()}`
            : clip.id;
          setSelectedClipId(dragClipId);
          setDragState({
            kind: "move",
            pointerId: event.pointerId,
            clipId: dragClipId,
            sourceClipId: clip.id,
            pointerStartX: event.clientX,
            originStartQ: clip.startQ,
            originDurationQ: durationQ,
            originLaneId: clip.laneId,
            duplicateOnDrag,
            jumpOnClick: isClipJumpPress(event, shortcutLabels.mac),
          });
        }}
        type="button"
      >
        {thumbnailUrl && !filmstrip ? (
          <span
            aria-hidden="true"
            className="clip-card__thumb"
            style={{
              backgroundImage: `url(${thumbnailUrl})`,
            }}
          />
        ) : null}
        {textStyle ? (
          <span
            aria-hidden="true"
            className="clip-card__glyph"
            style={{
              color:
                textStyle.paint.kind === "solid"
                  ? formatCssColor(textStyle.paint.color)
                  : undefined,
            }}
          >
            T
          </span>
        ) : null}
        {fxLabel ? (
          <span
            aria-hidden="true"
            className="clip-card__glyph clip-card__glyph--fx"
          >
            FX
          </span>
        ) : null}
        <span className="clip-card__text">
          <strong>
            {textStyle
              ? getTextPreview(textStyle) || clip.label
              : (fxLabel ?? clip.label)}
          </strong>
          <span className="clip-card__meta">
            {mediaSync ? (
              formatMediaSyncLabel(mediaSync)
            ) : (
              <>
                {formatMusicalPosition(clip.startQ, signature)} /{" "}
                {formatDuration(clip.durationSeconds)}
                {mediaState === "online"
                  ? ""
                  : ` / ${formatClipMediaState(mediaState)}`}
              </>
            )}
          </span>
        </span>
      </button>
      <button
        className={`clip-card__handle clip-card__handle--end${trimmingEnd ? " clip-card__handle--trimming" : ""}`}
        onPointerDown={(event) => {
          if (isContextMenuPress(event, shortcutLabels.mac)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          setPendingSelection(null);
          setDragPreviewClips(null);
          setSelectedClipId(clip.id);
          setDragState({
            kind: "resize-end",
            pointerId: event.pointerId,
            clipId: clip.id,
            pointerStartX: event.clientX,
            originStartQ: clip.startQ,
            originDurationQ: durationQ,
          });
        }}
        type="button"
      />
    </div>
  );
});
