import { useState } from "react";
import {
  fileManagerName,
  formatBarPosition,
  formatDuration,
  formatTakeDate,
} from "../format.ts";
import type { TakeInfo } from "../ipc/types.ts";
import { Folder, Play } from "./icons.tsx";

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
        {takes.length > 0 ? <span>Takes ({takes.length})</span> : null}
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
              revealLabel={`Show in ${fileManagerName(platform)}`}
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
  revealLabel: string;
  src: string;
  thumb: string;
  onPlay: () => void;
  onStop: () => void;
  onReveal: () => void;
};

function TakeCard({
  take,
  playing,
  revealLabel,
  src,
  thumb,
  onPlay,
  onStop,
  onReveal,
}: CardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const start = take.fileOffsetSec;
  const end = start + take.durationSec;
  const date = formatTakeDate(take.createdAt);
  return (
    <li className={`card take-card${take.missing ? " is-missing" : ""}`}>
      <div className="take-media">
        {playing ? (
          // biome-ignore lint/a11y/useMediaCaption: takes are silent camera video
          <video
            className="take-video"
            src={`${src}#t=${start},${end}`}
            autoPlay
            controls
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= end) {
                event.currentTarget.pause();
                onStop();
              }
            }}
            onEnded={onStop}
            onError={onStop}
          />
        ) : (
          <>
            {!take.missing && !thumbFailed ? (
              <img
                className="take-thumb"
                src={thumb}
                alt=""
                onError={() => setThumbFailed(true)}
              />
            ) : (
              <span className="take-thumb is-blank" />
            )}
            <button
              type="button"
              className="play-button"
              aria-label={`Preview take from ${date}`}
              disabled={take.missing}
              onClick={onPlay}
            >
              <Play />
            </button>
          </>
        )}
      </div>
      <div className="take-details">
        <p className="take-date">{date}</p>
        <p className="mono">{formatDuration(take.durationSec)}</p>
        {take.unanchored ||
        take.transportStartBeats === null ||
        take.timeSignature === null ? (
          <span className="badge">Not placed</span>
        ) : (
          <p className="mono">
            {formatBarPosition(take.transportStartBeats, take.timeSignature)}
          </p>
        )}
        {take.missing && <span className="badge is-warning">File missing</span>}
      </div>
      <button
        type="button"
        className="icon-button take-reveal"
        aria-label={revealLabel}
        title={revealLabel}
        disabled={take.missing}
        onClick={onReveal}
      >
        <Folder />
      </button>
    </li>
  );
}
