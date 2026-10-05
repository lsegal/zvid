import type { MouseEvent } from "react";
import { formatBuildLabel, getCommitUrl, shortCommit } from "../build-info";
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
      <svg viewBox="-8 -8 258 212" aria-hidden="true">
        <path fillRule="evenodd" d="M 2,48 C 6,26 22,2 46,2 H 204 C 219,2 230,11 230,25 V 40 C 230,48 225,54 217,58 C 220,52 213,50 202,50 H 5 Q 1,50 2,48 Z M 51,26 m -9,0 a 9,9 0 1,0 18,0 a 9,9 0 1,0 -18,0 Z M 91,26 m -10,0 a 10,10 0 1,0 20,0 a 10,10 0 1,0 -20,0 Z M 133,26 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z M 175,26 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z" />
        <path d="M 119,57 H 213 L 109,137 H 17 Q 9,137 5,142 Z" />
        <path fillRule="evenodd" d="M 4,144 C 8,140 15,145 26,145 H 236 Q 241,145 240,149 C 234,171 221,194 198,194 H 25 C 10,194 2,185 2,173 V 157 Q 2,149 4,144 Z M 78,169 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z M 121,169 m -11,0 a 11,11 0 1,0 22,0 a 11,11 0 1,0 -22,0 Z M 163,169 m -10,0 a 10,10 0 1,0 20,0 a 10,10 0 1,0 -20,0 Z M 203,169 m -9,0 a 9,9 0 1,0 18,0 a 9,9 0 1,0 -18,0 Z" />
      </svg>
      <span className="brand-mark__name" aria-hidden="true">
        zvid
      </span>
      <span
        className="brand-mark__tooltip"
        id="brand-mark-tooltip"
        role="tooltip"
      >
        <span className="brand-mark__tooltip-line">{APP_BUILD_LABEL}</span>
        <span className="brand-mark__tooltip-hint">
          Click to copy SHA
          {APP_COMMIT_URL ? " · Shift-click to open on GitHub" : ""}
        </span>
      </span>
    </button>
  );
}
