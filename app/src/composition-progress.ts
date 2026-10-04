// Clip progress for the group effect stack (`__group_main`), which is not
// tied to any one clip. It runs from 0 at the start of the composition to 1
// at the end of its last clip, so progress-driven effects such as Zoom & Pan
// ease across the whole arrangement.

// A piece of a layer clip (see render-clips.ts) counts as the whole clip.
type TimedClip = {
  startQ: number;
  durationSeconds: number;
  layerClipStartQ?: number;
  layerClipDurationSeconds?: number;
};

export function getCompositionEndQ(clips: TimedClip[], bpm: number) {
  return clips.reduce(
    (endQ, clip) =>
      Math.max(
        endQ,
        (clip.layerClipStartQ ?? clip.startQ) +
          ((clip.layerClipDurationSeconds ?? clip.durationSeconds) * bpm) / 60,
      ),
    0,
  );
}

export function getGroupClipProgress(
  clips: TimedClip[],
  playheadQ: number,
  bpm: number,
) {
  const endQ = getCompositionEndQ(clips, bpm);
  if (!(endQ > 0)) {
    return 0;
  }

  return Math.max(0, Math.min(1, playheadQ / endQ));
}
