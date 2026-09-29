import { type CSSProperties, useSyncExternalStore } from "react";
import type { MediaSyncView } from "../peer-media-sync";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function getReducedMotion() {
  return window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => false,
  );
}

type MediaSyncSkeletonProps = {
  view: MediaSyncView;
  variant: "clip" | "span" | "waveform";
  style?: CSSProperties;
};

// Shimmer fill drawn in place of a filmstrip or waveform while media syncs
// from a peer, with a progress bar along the bottom once bytes arrive. The
// shimmer only animates under the parent's .is-syncing--animated class.
export function MediaSyncSkeleton({
  view,
  variant,
  style,
}: MediaSyncSkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`media-sync media-sync--${variant}`}
      style={style}
    >
      <span className="media-sync__shimmer" />
      {view.phase === "receiving" ? (
        <span className="media-sync__track">
          <span
            className={`media-sync__bar ${view.fraction === null ? "media-sync__bar--indeterminate" : ""}`}
            style={
              view.fraction === null
                ? undefined
                : { width: `${view.fraction * 100}%` }
            }
          />
        </span>
      ) : null}
    </span>
  );
}
