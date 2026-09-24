import type { MouseEvent } from "react";
import {
  formatBuildLabel,
  getCommitUrl,
  shortCommit,
} from "../build-info";
import "./brand-mark.css";

export const APP_COMMIT = __APP_COMMIT__;
export const APP_BUILD_LABEL = formatBuildLabel(
  __APP_COMMIT__,
  __APP_BUILD_TIME__,
);
const APP_COMMIT_URL = getCommitUrl(APP_COMMIT);
const APP_SHORT_COMMIT = shortCommit(APP_COMMIT);

// Copies the full build SHA and returns a status message describing the result.
export async function copyBuildCommit() {
  try {
    await navigator.clipboard.writeText(APP_COMMIT);
    return `Copied build ${APP_SHORT_COMMIT} to the clipboard.`;
  } catch (error) {
    return `Copying build ${APP_SHORT_COMMIT} failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

// Opens the build's commit on GitHub; falls back to copying the SHA when the
// build has no commit to link to.
export async function openBuildCommit() {
  if (!APP_COMMIT_URL) {
    return copyBuildCommit();
  }
  window.open(APP_COMMIT_URL, "_blank", "noopener,noreferrer");
  return `Opened build ${APP_SHORT_COMMIT} on GitHub.`;
}

type BrandMarkProps = {
  onStatus: (message: string) => void;
};

export function BrandMark({ onStatus }: BrandMarkProps) {
  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    const openCommit = event.shiftKey || event.metaKey || event.ctrlKey;
    onStatus(await (openCommit ? openBuildCommit() : copyBuildCommit()));
  };

  return (
    <button
      aria-describedby="brand-mark-tooltip"
      aria-label={`zvid, build ${APP_SHORT_COMMIT}`}
      className="brand-mark"
      onClick={(event) => void handleClick(event)}
      type="button"
    >
      <svg viewBox="0 0 120 24" aria-hidden="true">
        <circle cx="14" cy="12" r="8" />
        <circle cx="36" cy="12" r="8" />
        <circle cx="60" cy="12" r="10" />
        <circle cx="84" cy="12" r="8" />
        <circle cx="106" cy="12" r="8" />
      </svg>
      <span className="brand-mark__name" aria-hidden="true">
        zvid
      </span>
      <span className="brand-mark__tooltip" id="brand-mark-tooltip" role="tooltip">
        <span className="brand-mark__tooltip-line">{APP_BUILD_LABEL}</span>
        <span className="brand-mark__tooltip-hint">
          Click to copy SHA
          {APP_COMMIT_URL ? " · Shift-click to open on GitHub" : ""}
        </span>
      </span>
    </button>
  );
}
