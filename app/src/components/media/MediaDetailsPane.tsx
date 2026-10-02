import { ChevronDownIcon } from "@heroicons/react/24/solid";
import type { MediaItem } from "../../media";
import type { MediaSyncView } from "../../remote-media-sync";
import { MediaThumbnail } from "./MediaThumbnail";
import { getMediaDetailRows } from "./media-details-pane-model.ts";

type MediaDetailsPaneProps = {
  media: MediaItem | undefined;
  thumbnailUrl: string | undefined;
  mediaSync: MediaSyncView | null;
  prefersReducedMotion: boolean;
  durationText: string;
  isOpen: boolean;
  onToggle: () => void;
};

// The selected media's file details under the Media drawer's items, or at
// their right when the drawer is wide: a preview thumbnail over a key/value
// table, like the macOS open panel's preview. Its header collapses it.
export function MediaDetailsPane({
  media,
  thumbnailUrl,
  mediaSync,
  prefersReducedMotion,
  durationText,
  isOpen,
  onToggle,
}: MediaDetailsPaneProps) {
  return (
    <section
      aria-label="Media details"
      className={["media-details", isOpen ? "is-open" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        aria-controls="media-details-content"
        aria-expanded={isOpen}
        className="media-details__toggle"
        onClick={onToggle}
        type="button"
      >
        <ChevronDownIcon aria-hidden="true" />
        Details
      </button>
      {isOpen ? (
        <div className="media-details__content" id="media-details-content">
          {media ? (
            <>
              <div className="media-details__preview">
                <MediaThumbnail
                  media={media}
                  mediaSync={mediaSync}
                  prefersReducedMotion={prefersReducedMotion}
                  thumbnailUrl={thumbnailUrl}
                />
              </div>
              <dl className="media-details__table">
                {getMediaDetailRows(media, durationText).map((row) => (
                  <div className="media-details__row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd title={row.value}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="media-details__empty">No media selected</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
