// A layer's or source track's Hide switch. A hidden layer draws nothing and
// takes no Order slot, but can still be a Mask's Target; a hidden source
// track's video draws nowhere (see render-clips.ts). Neither changes audio.
// A missing flag means shown, and showing a track drops the flag.
export type HideableTrack = {
  id: string;
  hidden?: boolean;
};

export function isTrackHidden(track: HideableTrack | undefined) {
  return track?.hidden === true;
}

export function setTrackHidden<T extends HideableTrack>(
  tracks: T[],
  trackId: string,
  hidden: boolean,
) {
  const index = tracks.findIndex((track) => track.id === trackId);
  if (index < 0 || isTrackHidden(tracks[index]) === hidden) {
    return tracks;
  }

  const { hidden: _hidden, ...shown } = tracks[index];
  const result = tracks.slice();
  result[index] = (hidden ? { ...shown, hidden: true } : shown) as T;
  return result;
}

export function trackHiddenHistoryLabel(trackName: string, hidden: boolean) {
  return `${hidden ? "Hide" : "Show"} ${trackName}`;
}
