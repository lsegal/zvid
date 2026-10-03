import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/solid";
import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { formatMediaTime } from "../../app/media-preview.ts";
import type { MediaDrawerState } from "../../hooks/useMediaDrawer.ts";
import type { MediaItem } from "../../media";
import { hasMediaDetails } from "../../media-details.ts";
import { endMediaDrag, startMediaDrag } from "../../media-drag.ts";
import { hasMediaRange } from "../../media-range.ts";
import { RecordInputPicker } from "../../recording/RecordInputPicker";
import {
  readDefaultRecordInputs,
  setDefaultRecordInput,
  useRecordInputsVersion,
} from "../../recording/record-inputs.ts";
import {
  describeMediaSync,
  type RemoteMediaProgressMap,
} from "../../remote-media-sync";
import { getThumbnailCacheKey } from "../../thumbnail-cache.ts";
import type { TimeValueFormat } from "../../time-value.ts";
import { useThumbnailCache } from "../../use-thumbnail-cache";
import { MediaDetailsPane } from "./MediaDetailsPane";
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
const MEDIA_DRAWER_TABS = [
  { tab: "media", label: "Media" },
  { tab: "record", label: "Record" },
] as const;
// Frames are decoded once at the largest tile size and scaled down, so moving
// the slider never starts a decode.
const THUMBNAIL_DECODE_WIDTH = THUMBNAIL_SIZE_MAX;

type MediaDrawerProps = {
  drawer: MediaDrawerState;
  mediaItems: MediaItem[];
  remoteMediaProgress: RemoteMediaProgressMap;
  prefersReducedMotion: boolean;
  // Durations in the details pane read in the timeline's format.
  timeFormat: TimeValueFormat;
  onImport: () => void;
  // Double-click or Enter: preview the media in the preview pane's Media tab.
  onOpenMedia: (mediaId: string) => void;
  // The selected media can be read here but was saved without file details.
  onBackfillMediaDetails: (mediaId: string) => void;
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

// Drags the item's thumbnail with its name, built from the thumbnail already
// on screen so its frame shows at once.
function setMediaDragImage(event: ReactDragEvent<HTMLElement>, name: string) {
  const image = document.createElement("div");
  image.className = "media-drag-image";
  const thumbnail = event.currentTarget
    .querySelector(".media-thumb")
    ?.cloneNode(true) as HTMLElement | undefined;
  if (thumbnail) {
    thumbnail.querySelector(".media-thumb__badge")?.remove();
    image.append(thumbnail);
  }
  const label = document.createElement("span");
  label.className = "media-drag-image__name";
  label.textContent = name;
  image.append(label);
  document.body.append(image);
  event.dataTransfer.setDragImage(image, 16, 16);
  window.setTimeout(() => image.remove(), 0);
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
// Finder-like icon or list view, with search, a thumbnail size slider, the
// item count and the selected item's details, plus the handle that resizes
// it. Its Record tab sets the default camera and mic to record from.
export function MediaDrawer({
  drawer,
  mediaItems,
  remoteMediaProgress,
  prefersReducedMotion,
  timeFormat,
  onImport,
  onOpenMedia,
  onBackfillMediaDetails,
}: MediaDrawerProps) {
  const { isOpen, tab, view, thumbnailSize, query, selectedMediaId } = drawer;
  useRecordInputsVersion();
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

  const selectedMedia = mediaItems.find(
    (media) => media.id === selectedMediaId,
  );
  const needsDetails =
    isOpen &&
    !!selectedMedia &&
    selectedMedia.availability === "ready" &&
    !!selectedMedia.previewUrl &&
    !hasMediaDetails(selectedMedia);
  const selectedMediaIdToBackfill = needsDetails
    ? selectedMedia?.id
    : undefined;
  useEffect(() => {
    if (selectedMediaIdToBackfill) {
      onBackfillMediaDetails(selectedMediaIdToBackfill);
    }
  }, [onBackfillMediaDetails, selectedMediaIdToBackfill]);

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
    if (event.key === "Enter" && selectedMediaId) {
      event.preventDefault();
      event.stopPropagation();
      onOpenMedia(selectedMediaId);
      return;
    }
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
    const mediaSync = describeMediaSync(
      remoteMediaProgress.get(media.id),
      media.availability,
    );
    const offline = media.availability === "offline" && !mediaSync;
    const hasRange = hasMediaRange(media);
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
        {hasRange ? (
          <span
            className="media-badge media-badge--range"
            title="Has In/Out points"
          >
            In/Out
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
        draggable
        id={getOptionId(media.id)}
        key={media.id}
        onClick={() => {
          drawer.setSelectedMediaId(media.id);
          listboxRef.current?.focus();
        }}
        onDoubleClick={() => onOpenMedia(media.id)}
        // Dragged onto a source track it adds a clip of the media, trimmed to
        // its In/Out points.
        onDragEnd={endMediaDrag}
        onDragStart={(event) => {
          drawer.setSelectedMediaId(media.id);
          startMediaDrag(event.dataTransfer, [media.id]);
          setMediaDragImage(event, media.name);
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
            {hasRange || offline ? (
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
            <div
              aria-label="Media drawer"
              className="segmented-control media-drawer__tabs"
              role="tablist"
            >
              {MEDIA_DRAWER_TABS.map((option) => (
                <button
                  aria-selected={tab === option.tab}
                  className={tab === option.tab ? "is-active" : ""}
                  key={option.tab}
                  onClick={() => drawer.setTab(option.tab)}
                  role="tab"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {tab === "media" ? (
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
            ) : null}
            <button
              aria-label="Close media drawer"
              className="media-drawer__close"
              onClick={() => drawer.setOpen(false)}
              type="button"
            >
              <XMarkIcon aria-hidden="true" />
            </button>
          </div>
          {tab === "record" ? (
            <div className="media-drawer__record">
              <h2 className="media-drawer__record-title">Record</h2>
              <p className="media-drawer__record-subtitle">
                Configure your record inputs
              </p>
              <RecordInputPicker
                active={isOpen}
                choices={[readDefaultRecordInputs()]}
                onChange={setDefaultRecordInput}
                requested={drawer.recordRequested}
              />
            </div>
          ) : (
            <>
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

              <div className="media-drawer__content">
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
                        <div
                          aria-hidden="true"
                          className="media-row media-row--head"
                        >
                          <span />
                          <span>Name</span>
                          <span>Kind</span>
                          <span>Duration</span>
                        </div>
                      ) : null}
                      <div
                        aria-activedescendant={activeDescendant}
                        aria-label="Media items"
                        data-docked-listbox=""
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
                {mediaItems.length > 0 ? (
                  <MediaDetailsPane
                    durationText={
                      selectedMedia
                        ? formatMediaTime(
                            selectedMedia.durationSeconds,
                            timeFormat,
                          )
                        : ""
                    }
                    isOpen={drawer.detailsOpen}
                    media={selectedMedia}
                    mediaSync={
                      selectedMedia
                        ? describeMediaSync(
                            remoteMediaProgress.get(selectedMedia.id),
                            selectedMedia.availability,
                          )
                        : null
                    }
                    onToggle={drawer.toggleDetailsOpen}
                    prefersReducedMotion={prefersReducedMotion}
                    thumbnailUrl={
                      selectedMedia ? getThumbnailUrl(selectedMedia) : undefined
                    }
                  />
                ) : null}
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
            </>
          )}
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
