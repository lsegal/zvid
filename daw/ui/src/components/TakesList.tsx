import { useId, useState } from "react";
import {
  fileManagerName,
  formatBarPosition,
  formatDuration,
  formatTakeDate,
} from "../format.ts";
import type { TakeInfo } from "../ipc/types.ts";
import { Folder, Play } from "./icons.tsx";
import { TakePreview } from "./TakePreview.tsx";

type Props = {
  takes: TakeInfo[];
  platform: string | undefined;
  takeUrl: (id: string) => string;
  thumbUrl: (id: string) => string;
  loadFrame: (
    id: string,
    offsetSec: number,
    signal: AbortSignal,
  ) => Promise<string>;
  onReveal: (id: string) => void;
};

export function TakesList({
  takes,
  platform,
  takeUrl,
  thumbUrl,
  loadFrame,
  onReveal,
}: Props) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewed = takes.find(
    (take) => take.id === previewing && !take.missing,
  );
  return (
    <section className="takes" aria-labelledby="takes-heading">
      <h2 id="takes-heading" className="divider">
        <span>Takes ({takes.length})</span>
      </h2>
      {takes.length === 0 ? (
        <p className="takes-empty">Your takes will show up here</p>
      ) : (
        <ul className="take-list">
          {takes.map((take) => (
            <TakeCard
              key={take.id}
              take={take}
              fileManager={fileManagerName(platform)}
              thumb={thumbUrl(take.id)}
              onPreview={() => setPreviewing(take.id)}
              onReveal={() => onReveal(take.id)}
            />
          ))}
        </ul>
      )}
      {previewed && (
        <TakePreview
          key={previewed.id}
          take={previewed}
          src={takeUrl(previewed.id)}
          loadFrame={(offsetSec, signal) =>
            loadFrame(previewed.id, offsetSec, signal)
          }
          onClose={() => setPreviewing(null)}
        />
      )}
    </section>
  );
}

type CardProps = {
  take: TakeInfo;
  fileManager: string;
  thumb: string;
  onPreview: () => void;
  onReveal: () => void;
};

function TakeCard({
  take,
  fileManager,
  thumb,
  onPreview,
  onReveal,
}: CardProps) {
  const missingId = useId();
  const [poster, setPoster] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const date = formatTakeDate(take.createdAt);
  const placed =
    !take.unanchored &&
    take.transportStartBeats !== null &&
    take.timeSignature !== null;
  // Disabled buttons stay focusable; the badge explains them.
  const disabledProps = take.missing
    ? { "aria-disabled": true, "aria-describedby": missingId }
    : {};
  return (
    <li
      className={`card take-card${take.missing ? " is-missing" : ""}`}
      // One tab stop per card; its buttons are reachable inside it.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: DESIGN.md makes each take card a tab stop
      tabIndex={0}
      aria-label={`Take from ${date}`}
    >
      <div className="take-media">
        {take.missing || poster === "failed" ? (
          <span className="take-thumb is-blank" />
        ) : (
          <img
            className={`take-thumb${poster === "loading" ? " is-loading" : ""}`}
            src={thumb}
            alt=""
            onLoad={() => setPoster("ready")}
            onError={() => setPoster("failed")}
          />
        )}
      </div>
      <div className="take-details">
        <p className="take-date">{date}</p>
        <p className="mono">{formatDuration(take.durationSec)}</p>
        {placed ? (
          <p className="mono">
            {formatBarPosition(
              take.transportStartBeats ?? 0,
              take.timeSignature ?? [4, 4],
            )}
          </p>
        ) : (
          <span className="badge">Not placed</span>
        )}
        {take.missing && (
          <span id={missingId} className="badge is-warning">
            File missing
          </span>
        )}
      </div>
      <div className="take-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Preview take from ${date}`}
          aria-haspopup="dialog"
          {...disabledProps}
          onClick={() => {
            if (!take.missing) onPreview();
          }}
        >
          <Play />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Show take from ${date} in ${fileManager}`}
          title={`Show in ${fileManager}`}
          {...disabledProps}
          onClick={() => {
            if (!take.missing) onReveal();
          }}
        >
          <Folder />
        </button>
      </div>
    </li>
  );
}
