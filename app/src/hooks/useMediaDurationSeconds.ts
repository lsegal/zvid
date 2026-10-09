import { useEffect, useState } from "react";
import {
  isEffectMedia,
  type MediaItem,
  probeMediaUrlDuration,
} from "../media";
import { getKnownMediaDurationSeconds } from "../source-clip-properties.ts";

// The media's length in seconds, or 0 while it is offline, still loading or
// of unknown length. Media that plays but has no length recorded yet, such as
// a session's media opened before its files were read, has it read from its
// preview URL.
export function useMediaDurationSeconds(media: MediaItem | undefined) {
  const knownSeconds = getKnownMediaDurationSeconds(media);
  const probeUrl =
    media?.availability === "ready" &&
    !isEffectMedia(media) &&
    knownSeconds === 0
      ? media.previewUrl
      : "";
  const kind = media?.kind === "audio" ? "audio" : "video";
  const [probed, setProbed] = useState<{ url: string; seconds: number }>();

  useEffect(() => {
    if (!probeUrl) {
      return;
    }
    let canceled = false;
    void probeMediaUrlDuration(probeUrl, kind).then((seconds) => {
      if (!canceled) {
        setProbed({ url: probeUrl, seconds });
      }
    });
    return () => {
      canceled = true;
    };
  }, [kind, probeUrl]);

  if (knownSeconds > 0) {
    return knownSeconds;
  }
  return probeUrl && probed?.url === probeUrl ? probed.seconds : 0;
}
