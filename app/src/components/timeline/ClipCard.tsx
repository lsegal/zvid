import type { Dispatch, SetStateAction } from "react";
import { type Filmstrip, getFilmstripTileOwner } from "../../app/filmstrip.ts";
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
import { isContextMenuPress } from "../../context-menu.ts";
import { isFillClip } from "../../fill-clip.ts";
import {
  formatCssColor,
  formatFillPaintCss,
  resolveFillPaint,
} from "../../fill-paint.ts";
import { describeFxClip, isFxClip } from "../../fx-clip.ts";
import { clipEffectTrackId, type SessionEffect } from "../../fx-stack";
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
import { MediaSyncSkeleton } from "../MediaSyncSkeleton";

// What every clip card in the arrangement shares.
export type ClipCardContext = {
  selectedClipId: string | undefined;
  dragState: DragState | null;
  bpm: number;
  quarterPx: number;
  signature: TimeSignature;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  thumbnails: ThumbnailSnapshot;
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

type ClipCardProps = { clip: ArrangementClip } & ClipCardContext;

// An arrangement clip: its body, which selects, moves or Ctrl/Cmd-drags a
// duplicate, the trim handles either side, and its filmstrip, fill, text or
// FX badge, and media sync skeleton.
export function ClipCard({
  clip,
  selectedClipId,
  dragState,
  bpm,
  quarterPx,
  signature,
  mediaItemsById,
  thumbnails,
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
  // Keeps the trim handles shown while the pointer
  // strays off the clip mid-drag.
  const trimming =
    (dragState?.kind === "resize-start" || dragState?.kind === "resize-end") &&
    dragState.clipId === clip.id;
  const durationQ = getClipDurationQ(clip, bpm);
  const media = clip.mediaId ? mediaItemsById.get(clip.mediaId) : undefined;
  const mediaState = describeClipMediaState(clip, media?.availability);
  const thumbnailUrl =
    media?.hasVideo && mediaState === "online"
      ? (thumbnails.get(
          getThumbnailCacheKey(
            media.id,
            getClipThumbnailTimeSeconds(clip, media.durationSeconds, bpm),
            clipFilmstrips.get(clip.id)?.size,
          ),
          `clip:${clip.id}`,
        ) ?? media.thumbnailUrl)
      : undefined;
  const filmstrip =
    media?.hasVideo && mediaState === "online"
      ? clipFilmstrips.get(clip.id)
      : undefined;
  const mediaSync = media
    ? describeMediaSync(remoteMediaProgress.get(media.id), media.availability)
    : null;
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
      className={`clip-card ${selected ? "clip-card--selected" : ""} ${trimming ? "clip-card--trimming" : ""} ${filmstrip || fillBackground ? "clip-card--filmstrip" : ""} ${fillBackground ? "clip-card--fill" : ""} ${textStyle ? "clip-card--text" : ""} ${fxLabel ? "clip-card--fx" : ""} ${mediaSync ? getMediaSyncClassName(mediaSync, prefersReducedMotion) : ""} ${media && revealedMediaIds.has(media.id) ? "is-sync-revealed" : ""}`}
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
        borderColor: clip.accent,
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
      {filmstrip ? (
        <span aria-hidden="true" className="clip-card__filmstrip">
          {filmstrip.tiles.map((tile) => {
            // A tile shows the clip's first frame
            // until its own frame is decoded.
            const tileUrl =
              thumbnails.get(
                getThumbnailCacheKey(
                  filmstrip.media.id,
                  tile.timeSeconds,
                  filmstrip.size,
                ),
                getFilmstripTileOwner("clip", clip.id, tile.index),
              ) ?? thumbnailUrl;
            return (
              <span
                key={tile.index}
                className="clip-card__tile"
                style={{
                  left: tile.leftPx,
                  width: tile.widthPx,
                  backgroundImage: tileUrl ? `url(${tileUrl})` : undefined,
                }}
              />
            );
          })}
        </span>
      ) : null}
      <button
        className="clip-card__handle clip-card__handle--start"
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
        className="clip-card__handle clip-card__handle--end"
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
}
