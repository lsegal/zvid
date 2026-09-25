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
