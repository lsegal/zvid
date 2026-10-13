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
  // Images, which make clips; SVGs also feed Shape ▸ Custom.
  "svg",
  "jpg",
  "jpeg",
  "png",
  "apng",
  "webp",
  "gif",
  "avif",
  // 3D LUTs, used by the LUT effect.
  "cube",
];

export function hasMediaExtension(name: string) {
  const lower = name.toLowerCase();
  return MEDIA_EXTENSIONS.some((extension) => lower.endsWith(`.${extension}`));
}
