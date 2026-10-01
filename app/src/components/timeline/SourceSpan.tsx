import type {
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import { type Filmstrip, getFilmstripTileOwner } from "../../app/filmstrip.ts";
import type { getShortcutLabels } from "../../app/shortcut-labels.ts";
import { getClipDurationQ } from "../../app/timeline-math.ts";
import type {
  ClipMenuState,
  SourceSpan as SourceSpanClip,
  SourceSpanDragState,
} from "../../app/types.ts";
import {
  describeClipMediaState,
  formatClipMediaState,
} from "../../clip-media-state";
import { isContextMenuPress } from "../../context-menu.ts";
import type { MediaItem } from "../../media";
import type { useMenus } from "../../menus/useMenus.ts";
import {
  describeMediaSync,
  formatMediaSyncLabel,
  getMediaSyncClassName,
  type RemoteMediaProgressMap,
} from "../../remote-media-sync.ts";
import { isSourceClipDropClick } from "../../source-clip-drop.ts";
import {
  getThumbnailCacheKey,
  type ThumbnailSnapshot,
} from "../../thumbnail-cache.ts";
import { MediaSyncSkeleton } from "../MediaSyncSkeleton";
import "./source-span.css";

// What every source span shares.
export type SourceSpanContext = {
  bpm: number;
  quarterPx: number;
  mediaItemsById: ReadonlyMap<string, MediaItem>;
  thumbnails: ThumbnailSnapshot;
  spanFilmstrips: ReadonlyMap<string, Filmstrip>;
  remoteMediaProgress: RemoteMediaProgressMap;
  prefersReducedMotion: boolean;
  revealedMediaIds: ReadonlySet<string>;
  clipMenu: ClipMenuState | null;
  shortcutLabels: ReturnType<typeof getShortcutLabels>;
  addSourceSpanToArrangement: (sourceSpan: SourceSpanClip) => void;
  openSourceSpanMenu: ReturnType<typeof useMenus>["openSourceSpanMenu"];
  sourceSpanDrag: SourceSpanDragState | null;
  setSourceSpanDrag: Dispatch<SetStateAction<SourceSpanDragState | null>>;
};

type SourceSpanProps = { clip: SourceSpanClip } & SourceSpanContext;

// A span of a source track's media: its filmstrip or thumbnail and name.
// Dragging it moves it in its track and dragging an edge trims it, like an
// arrangement clip; Ctrl/Cmd-click adds it to the arrangement.
export function SourceSpan({
  clip,
  bpm,
  quarterPx,
  mediaItemsById,
  thumbnails,
  spanFilmstrips,
  remoteMediaProgress,
  prefersReducedMotion,
  revealedMediaIds,
  clipMenu,
  shortcutLabels,
  addSourceSpanToArrangement,
  openSourceSpanMenu,
  sourceSpanDrag,
  setSourceSpanDrag,
}: SourceSpanProps) {
  const media = clip.mediaId ? mediaItemsById.get(clip.mediaId) : undefined;
  const mediaState = describeClipMediaState(clip, media?.availability);
  const thumbnailUrl =
    (media &&
      thumbnails.get(
        getThumbnailCacheKey(
          media.id,
          clip.trimStartSeconds,
          spanFilmstrips.get(clip.id)?.size,
        ),
        `span:${clip.id}`,
      )) ??
    media?.thumbnailUrl;
  const filmstrip =
    media?.hasVideo && mediaState === "online"
      ? spanFilmstrips.get(clip.id)
      : undefined;
  const mediaSync = media
    ? describeMediaSync(remoteMediaProgress.get(media.id), media.availability)
    : null;
  // Keeps the trim handles shown while the pointer strays off the span
  // mid-drag.
  const trimming =
    sourceSpanDrag?.spanId === clip.id && sourceSpanDrag.kind !== "move";

  function startDrag(
    event: ReactPointerEvent,
    kind: SourceSpanDragState["kind"],
  ) {
    // Right-click and Ctrl/Cmd-click keep opening the menu and adding the
    // span to the arrangement.
    if (
      event.button !== 0 ||
      isContextMenuPress(event, shortcutLabels.mac) ||
      isSourceClipDropClick(event)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSourceSpanDrag({
      kind,
      pointerId: event.pointerId,
      spanId: clip.id,
      pointerStartX: event.clientX,
    });
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dragging, Ctrl/Cmd-click and right-click are pointer gestures; pressing a source layer's number key commits a selection from the keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: a plain click does nothing, so there is no keyboard equivalent to add
    <div
      className={`source-span ${trimming ? "source-span--trimming" : ""} ${filmstrip ? "source-span--filmstrip" : ""} ${mediaSync ? getMediaSyncClassName(mediaSync, prefersReducedMotion) : ""} ${media && revealedMediaIds.has(media.id) ? "is-sync-revealed" : ""} ${clipMenu?.kind === "span" && clipMenu.spanId === clip.id ? "source-span--selected" : ""}`}
      onClick={(event) => {
        // Ctrl-click on macOS opens the menu instead.
        if (
          !isSourceClipDropClick(event) ||
          isContextMenuPress(event, shortcutLabels.mac)
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        addSourceSpanToArrangement(clip);
      }}
      onContextMenu={(event) => openSourceSpanMenu(event, clip)}
      onPointerDown={(event) => startDrag(event, "move")}
      title={`${shortcutLabels.sourceClipDrop} to add this clip to the arrangement`}
      style={{
        left: clip.startQ * quarterPx,
        width: getClipDurationQ(clip, bpm) * quarterPx,
        ["--clip-accent" as string]: clip.accent,
        backgroundColor: clip.tint,
        borderColor: clip.accent,
        opacity: mediaState === "online" || mediaSync ? 1 : 0.56,
      }}
    >
      {mediaSync ? (
        <MediaSyncSkeleton variant="span" view={mediaSync} />
      ) : filmstrip ? (
        <span aria-hidden="true" className="source-span__filmstrip">
          {filmstrip.tiles.map((tile) => {
            // A tile shows the span's start
            // frame until its own frame is
            // decoded.
            const tileUrl =
              thumbnails.get(
                getThumbnailCacheKey(
                  filmstrip.media.id,
                  tile.timeSeconds,
                  filmstrip.size,
                ),
                getFilmstripTileOwner("span", clip.id, tile.index),
              ) ?? thumbnailUrl;
            return (
              <span
                key={tile.index}
                className="source-span__tile"
                style={{
                  left: tile.leftPx,
                  width: tile.widthPx,
                  backgroundImage: tileUrl ? `url(${tileUrl})` : undefined,
                }}
              />
            );
          })}
        </span>
      ) : (
        <div
          className="source-span__thumb"
          style={
            thumbnailUrl
              ? {
                  backgroundImage: `url(${thumbnailUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        />
      )}
      <div className="source-span__body">
        <span>{clip.label}</span>
        <small>
          {mediaSync
            ? formatMediaSyncLabel(mediaSync)
            : formatClipMediaState(mediaState)}
        </small>
        <div
          className="source-span__line"
          style={{ backgroundColor: clip.accent }}
        />
      </div>
      <button
        aria-label={`Trim the start of ${clip.label}`}
        className="source-span__handle source-span__handle--start"
        onPointerDown={(event) => startDrag(event, "resize-start")}
        tabIndex={-1}
        type="button"
      />
      <button
        aria-label={`Trim the end of ${clip.label}`}
        className="source-span__handle source-span__handle--end"
        onPointerDown={(event) => startDrag(event, "resize-end")}
        tabIndex={-1}
        type="button"
      />
    </div>
  );
}
