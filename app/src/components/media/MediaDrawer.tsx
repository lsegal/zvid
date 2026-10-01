import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useMemo,
  useRef,
} from "react";
import type { MediaDrawerState } from "../../hooks/useMediaDrawer.ts";
import type { MediaItem } from "../../media";
import {
  describeMediaSync,
  type RemoteMediaProgressMap,
} from "../../remote-media-sync";
import { getThumbnailCacheKey } from "../../thumbnail-cache.ts";
import { useThumbnailCache } from "../../use-thumbnail-cache";
import { MediaThumbnail } from "./MediaThumbnail";
import {
  describeMediaKind,
  filterMediaItems,
  formatMediaDuration,
  formatMediaItemCount,
  getListIconSize,
  getNextMediaIndex,
  getTileNameMaxChars,
  middleEllipsis,
  THUMBNAIL_SIZE_MAX,
  THUMBNAIL_SIZE_MIN,
} from "./media-drawer-model.ts";
import "./media-drawer.css";

export const MEDIA_DRAWER_ID = "media-drawer";
// Frames are decoded once at the largest tile size and scaled down, so moving
// the slider never starts a decode.
const THUMBNAIL_DECODE_WIDTH = THUMBNAIL_SIZE_MAX;

type MediaDrawerProps = {
  drawer: MediaDrawerState;
  mediaItems: MediaItem[];
  mainAudioId: string | undefined;
  remoteMediaProgress: RemoteMediaProgressMap;
  prefersReducedMotion: boolean;
  onImport: () => void;
};

function getThumbnailTime(media: MediaItem) {
  return Math.min(1, Math.max(0, media.durationSeconds) * 0.1);
}

function getThumbnailSize(media: MediaItem) {
  const aspect =
    media.width && media.height ? media.height / media.width : 9 / 16;
  return {
    width: THUMBNAIL_DECODE_WIDTH,
    height: Math.max(1, Math.round(THUMBNAIL_DECODE_WIDTH * aspect)),
  };
}

function getOptionId(mediaId: string) {
  return `media-drawer-item-${mediaId}`;
}

// How many options share the first option's row: the grid's column count.
function countColumns(listbox: HTMLElement) {
  const options = listbox.querySelectorAll<HTMLElement>('[role="option"]');
  const top = options[0]?.offsetTop;
  let columns = 0;
  for (const option of options) {
    if (option.offsetTop !== top) {
      break;
    }
    columns += 1;
  }
  return Math.max(1, columns);
}

// The Media drawer at the left of the timeline: every linked media item in a
// Finder-like icon or list view, with search, a thumbnail size slider and
// the item count, plus the handle that resizes it.
export function MediaDrawer({
  drawer,
  mediaItems,
  mainAudioId,
  remoteMediaProgress,
  prefersReducedMotion,
  onImport,
}: MediaDrawerProps) {
  const { isOpen, view, thumbnailSize, query, selectedMediaId } = drawer;
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const searching = query.trim() !== "";
  const visibleItems = useMemo(
    () => filterMediaItems(mediaItems, query),
    [mediaItems, query],
  );

  const thumbnailRequests = useMemo(
    () =>
      isOpen
        ? mediaItems.flatMap((media) => {
            if (
              !media.hasVideo ||
              !media.previewUrl ||
              media.availability !== "ready"
            ) {
              return [];
            }
            const timeSeconds = getThumbnailTime(media);
            const size = getThumbnailSize(media);
            return [
              {
                key: getThumbnailCacheKey(media.id, timeSeconds, size),
                owner: `media:${media.id}`,
                media,
                sourceUrl: media.previewUrl,
                timeSeconds,
                size,
              },
            ];
          })
        : [],
    [isOpen, mediaItems],
  );
  const thumbnails = useThumbnailCache(thumbnailRequests);
  const getThumbnailUrl = (media: MediaItem) =>
    (media.hasVideo &&
      thumbnails.get(
        getThumbnailCacheKey(
          media.id,
          getThumbnailTime(media),
          getThumbnailSize(media),
        ),
        `media:${media.id}`,
      )) ||
    media.thumbnailUrl;

  function selectIndex(index: number) {
    const media = visibleItems[index];
    if (!media) {
      return;
    }
    drawer.setSelectedMediaId(media.id);
    listboxRef.current
      ?.querySelector(`#${CSS.escape(getOptionId(media.id))}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const index = visibleItems.findIndex(
      (media) => media.id === selectedMediaId,
    );
    const columns =
      view === "icons" && listboxRef.current
        ? countColumns(listboxRef.current)
        : 1;
    const next = getNextMediaIndex(
      event.key,
      index,
      visibleItems.length,
      columns,
    );
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectIndex(next);
  }

  const activeDescendant = visibleItems.some(
    (media) => media.id === selectedMediaId,
  )
    ? getOptionId(selectedMediaId as string)
    : undefined;
  const nameMaxChars = getTileNameMaxChars(thumbnailSize);

  function renderItem(media: MediaItem) {
    const selected = media.id === selectedMediaId;
    const isMainAudio = media.id === mainAudioId;
    const mediaSync = describeMediaSync(
      remoteMediaProgress.get(media.id),
      media.availability,
    );
    const offline = media.availability === "offline" && !mediaSync;
    const duration = formatMediaDuration(media.durationSeconds);
    const className = [
      view === "icons" ? "media-tile" : "media-row",
      selected ? "is-selected" : "",
      offline ? "is-offline" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const badges = (
      <>
        {isMainAudio ? (
          <span className="media-badge media-badge--audio-track">
            Audio track
          </span>
        ) : null}
        {offline ? (
          <span className="media-badge media-badge--offline">Offline</span>
        ) : null}
      </>
    );

    return (
      // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox, which points at this item with aria-activedescendant
      // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles keys for every item
      <div
        aria-selected={selected}
        className={className}
        data-media-id={media.id}
        data-availability={media.availability}
        id={getOptionId(media.id)}
        key={media.id}
        onClick={() => {
          drawer.setSelectedMediaId(media.id);
          listboxRef.current?.focus();
        }}
        role="option"
        title={media.name}
      >
        <MediaThumbnail
          badge={view === "icons" ? duration : undefined}
          media={media}
          mediaSync={mediaSync}
          prefersReducedMotion={prefersReducedMotion}
          thumbnailUrl={getThumbnailUrl(media)}
        />
        {view === "icons" ? (
          <>
            <span className="media-tile__name">
              {middleEllipsis(media.name, nameMaxChars)}
            </span>
            {isMainAudio || offline ? (
              <span className="media-tile__badges">{badges}</span>
            ) : null}
          </>
        ) : (
          <>
            <span className="media-row__name">
              <span className="media-row__label">{media.name}</span>
              {badges}
            </span>
            <span className="media-row__kind">{describeMediaKind(media)}</span>
            <span className="media-row__duration">{duration}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      className={[
        "media-drawer-column",
        isOpen ? "is-open" : "",
        drawer.isResizing ? "is-resizing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--media-drawer-width" as string]: `${drawer.width}px` }}
    >
      <aside
        aria-hidden={!isOpen}
        aria-label="Media"
        className="media-drawer"
        id={MEDIA_DRAWER_ID}
        inert={!isOpen}
      >
        <div className="media-drawer__panel">
          <div className="media-drawer__header">
            <strong className="media-drawer__title">Media</strong>
            <div className="segmented-control">
              {(["icons", "list"] as const).map((option) => (
                <button
                  aria-pressed={view === option}
                  className={view === option ? "is-active" : ""}
                  key={option}
                  onClick={() => drawer.setView(option)}
                  type="button"
                >
                  {option === "icons" ? "Icons" : "List"}
                </button>
              ))}
            </div>
            <button
              aria-label="Close media drawer"
              className="media-drawer__close"
              onClick={() => drawer.setOpen(false)}
              type="button"
            >
              <XMarkIcon aria-hidden="true" />
            </button>
          </div>
          <div className="media-drawer__search">
            <MagnifyingGlassIcon aria-hidden="true" />
            <input
              aria-label="Search media"
              onChange={(event) => drawer.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.stopPropagation();
                  drawer.setQuery("");
                }
              }}
              placeholder="Search"
              type="text"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear search"
                className="media-drawer__clear"
                onClick={() => drawer.setQuery("")}
                type="button"
              >
                <XMarkIcon aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="media-drawer__body">
            {mediaItems.length === 0 ? (
              <div className="media-drawer__empty">
                <span>No media yet</span>
                <button
                  className="ghost-button ghost-button--accent"
                  onClick={onImport}
                  type="button"
                >
                  Import Media
                </button>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="media-drawer__empty">
                <span>No media matches “{query.trim()}”</span>
              </div>
            ) : (
              <>
                {view === "list" ? (
                  <div aria-hidden="true" className="media-row media-row--head">
                    <span />
                    <span>Name</span>
                    <span>Kind</span>
                    <span>Duration</span>
                  </div>
                ) : null}
                <div
                  aria-activedescendant={activeDescendant}
                  aria-label="Media items"
                  className={
                    view === "icons"
                      ? "media-drawer__grid"
                      : "media-drawer__list"
                  }
                  onKeyDown={handleListKeyDown}
                  ref={listboxRef}
                  role="listbox"
                  style={
                    {
                      "--media-tile-size": `${thumbnailSize}px`,
                      "--media-list-icon-size": `${getListIconSize(thumbnailSize)}px`,
                    } as CSSProperties
                  }
                  tabIndex={0}
                >
                  {visibleItems.map(renderItem)}
                </div>
              </>
            )}
          </div>

          <div className="media-drawer__status">
            <span className="media-drawer__count" aria-live="polite">
              {formatMediaItemCount(
                visibleItems.length,
                mediaItems.length,
                searching,
              )}
            </span>
            <input
              aria-label="Thumbnail size"
              className="media-drawer__size"
              max={THUMBNAIL_SIZE_MAX}
              min={THUMBNAIL_SIZE_MIN}
              onChange={(event) =>
                drawer.setThumbnailSize(Number(event.target.value))
              }
              step={8}
              type="range"
              value={thumbnailSize}
            />
          </div>
        </div>
      </aside>
      <hr
        aria-label="Resize media drawer"
        aria-orientation="vertical"
        aria-valuemax={drawer.maxWidth}
        aria-valuemin={drawer.minWidth}
        aria-valuenow={drawer.width}
        className="media-drawer-resize-handle"
        hidden={!isOpen}
        onDoubleClick={drawer.resetWidth}
        onKeyDown={drawer.handleResizeKeyDown}
        onPointerCancel={drawer.handleResizePointerEnd}
        onPointerDown={drawer.handleResizePointerDown}
        onPointerMove={drawer.handleResizePointerMove}
        onPointerUp={drawer.handleResizePointerEnd}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
      />
    </div>
  );
}
