// "Copy share link" buttons for a live share (the status bar button and the
// link icon next to Stop Share): when they show, what they say, and how a copy
// attempt resolves. Kept free of React so it can be unit
// tested directly.

export type ShareLinkCopyState = "idle" | "copied" | "failed";

// How long "Copied ✓" stays before the button goes back to "Copy share link".
export const SHARE_LINK_COPIED_RESET_MS = 2000;

// How long the top bar link icon shows a check after a successful copy.
export const SHARE_LINK_ICON_COPIED_RESET_MS = 1500;

// Shown only while hosting a share, and only once its invite URL is built.
export function shareLinkVisible(
  mode: "idle" | "sharing" | "connected",
  shareUrl: string,
) {
  return mode === "sharing" && shareUrl !== "";
}

export function shareLinkButtonLabel(state: ShareLinkCopyState) {
  switch (state) {
    case "copied":
      return "Copied ✓";
    case "failed":
      return "Copy failed";
    default:
      return "Copy share link";
  }
}

type ClipboardWriter = { writeText(text: string): Promise<void> };

// Resolves to "failed" rather than throwing, including when there is no
// clipboard at all (insecure contexts such as a plain-http IP invite).
export async function copyShareLink(
  url: string,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
): Promise<ShareLinkCopyState> {
  if (!clipboard) {
    return "failed";
  }
  try {
    await clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

// Status message when the automatic copy at share start fails.
export function shareCopyFailedStatus(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  return `Public sharing is live, but copying the invite failed: ${reason}. Use Copy share link in the status bar to copy it.`;
}
