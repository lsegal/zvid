/** Media file extensions (without the leading dot) accepted by every harness. */
export const MEDIA_EXTENSIONS = [
  "mp4",
  "mov",
  "mkv",
  "webm",
  "avi",
  "wav",
  "mp3",
  "m4a",
  "flac",
  "aif",
  "aiff",
  // Opus audio, on its own or in Ogg.
  "opus",
  "ogg",
  "oga",
  // Images, used by effects such as Shape ▸ Custom rather than as clips.
  "svg",
];

export function hasMediaExtension(name: string) {
  const lower = name.toLowerCase();
  return MEDIA_EXTENSIONS.some((extension) => lower.endsWith(`.${extension}`));
}
