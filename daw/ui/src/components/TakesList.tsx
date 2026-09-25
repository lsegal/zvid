import { useId, useState } from "react";
import {
  fileManagerName,
  formatBarPosition,
  formatDuration,
  formatTakeDate,
} from "../format.ts";
import type { TakeInfo } from "../ipc/types.ts";
import { Folder, Play, Stop } from "./icons.tsx";

type Props = {
  takes: TakeInfo[];
  platform: string | undefined;
  takeUrl: (id: string) => string;
  thumbUrl: (id: string) => string;
  onReveal: (id: string) => void;
};

export function TakesList({
  takes,
  platform,
  takeUrl,
  thumbUrl,
  onReveal,
}: Props) {
  const [playing, setPlaying] = useState<string | null>(null);
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
              playing={playing === take.id}
              fileManager={fileManagerName(platform)}
              src={takeUrl(take.id)}
              thumb={thumbUrl(take.id)}
              onPlay={() => setPlaying(take.id)}
              onStop={() =>
                setPlaying((current) => (current === take.id ? null : current))
              }
              onReveal={() => onReveal(take.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type CardProps = {
  take: TakeInfo;
  playing: boolean;
  fileManager: string;
  src: string;
  thumb: string;
  onPlay: () => void;
  onStop: () => void;
  onReveal: () => void;
};

function TakeCard({
  take,
  playing,
  fileManager,
  src,
  thumb,
  onPlay,
  onStop,
  onReveal,
}: CardProps) {
  const missingId = useId();
  const [poster, setPoster] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const start = take.fileOffsetSec;
  const end = start + take.durationSec;
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
        {playing ? (
          // biome-ignore lint/a11y/useMediaCaption: takes are silent camera video
          <video
            className="take-video"
            src={`${src}#t=${start},${end}`}
            autoPlay
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= end) {
                event.currentTarget.pause();
                onStop();
              }
            }}
            onEnded={onStop}
            onError={onStop}
          />
        ) : take.missing || poster === "failed" ? (
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
          aria-label={
            playing
              ? `Stop preview of take from ${date}`
              : `Preview take from ${date}`
          }
          {...disabledProps}
          onClick={() => {
            if (take.missing) return;
            if (playing) onStop();
            else onPlay();
          }}
        >
          {playing ? <Stop /> : <Play />}
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
