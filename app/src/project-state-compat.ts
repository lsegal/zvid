// Collaboration peers on builds from before the "main audio" rename publish
// the session's main audio as `masterAudioId`. Reading it keeps their audio
// selection when they share a room with newer peers.
export function migrateLegacyMainAudio<T extends object>(snapshot: T): T {
  if (!("masterAudioId" in snapshot)) {
    return snapshot;
  }
  const { masterAudioId, ...rest } = snapshot as T & {
    mainAudioId?: string;
    masterAudioId?: string;
  };
  return {
    ...rest,
    mainAudioId: rest.mainAudioId ?? masterAudioId,
  } as T;
}

// Peers on builds from before selection was per-user mark clips with a
// `selected` flag. Selection is local, so drop it rather than let a stale
// flag travel with the project.
export function stripClipSelectionFlags<T extends object>(snapshot: T): T {
  const { clips } = snapshot as T & { clips?: unknown };
  if (
    !Array.isArray(clips) ||
    !clips.some(
      (clip) => typeof clip === "object" && clip && "selected" in clip,
    )
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    clips: clips.map((clip) => {
      if (typeof clip !== "object" || !clip || !("selected" in clip)) {
        return clip;
      }
      const { selected: _selected, ...rest } = clip;
      return rest;
    }),
  };
}
