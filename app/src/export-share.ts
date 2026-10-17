// Sharing a finished export through the Web Share API: on phones the native
// share sheet lists the installed apps that take a video, such as Instagram
// and TikTok. Desktop browsers mostly can't share files, so Share there
// downloads the file instead.

// Whether the browser's share sheet can take `file`.
export function canShareFile(file: File) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

export type ShareOutcome = "shared" | "dismissed" | "unsupported";

// Opens the share sheet with `file` attached. Call it straight from the
// click, since browsers only share during a user gesture.
export async function shareFile(file: File): Promise<ShareOutcome> {
  if (!navigator.share || !canShareFile(file)) {
    return "unsupported";
  }
  try {
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    // Closing the share sheet without picking an app.
    if (error instanceof DOMException && error.name === "AbortError") {
      return "dismissed";
    }
    throw error;
  }
}
