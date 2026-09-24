// Describes whether a clip's media can be shown. Placeholder clips, such as
// MIDI clips imported from a Live set without Layers video, never had a media
// file, so they get their own state instead of reading as offline.

import type { MediaAvailability } from "./media.ts";

export type ClipMediaState = "online" | "hydrating" | "offline" | "placeholder";

export type ClipMediaRef = {
  mediaId?: string;
  mediaPath?: string;
};

export function isPlaceholderClip(clip: ClipMediaRef) {
  return !clip.mediaId && !clip.mediaPath?.trim();
}

export function describeMediaAvailability(
  availability: MediaAvailability | undefined,
): Exclude<ClipMediaState, "placeholder"> {
  switch (availability) {
    case "ready":
      return "online";
    case "hydrating":
      return "hydrating";
    default:
      return "offline";
  }
}

export function describeClipMediaState(
  clip: ClipMediaRef,
  availability: MediaAvailability | undefined,
): ClipMediaState {
  return isPlaceholderClip(clip)
    ? "placeholder"
    : describeMediaAvailability(availability);
}

// Short label shown on arrangement clips and source-track spans.
export function formatClipMediaState(state: ClipMediaState) {
  switch (state) {
    case "online":
      return "online";
    case "hydrating":
      return "hydrating...";
    case "placeholder":
      return "no media";
    default:
      return "offline clip";
  }
}

// Program monitor message for a clip at the playhead that cannot be drawn.
export function describePreviewMediaState(
  state: Exclude<ClipMediaState, "online">,
) {
  switch (state) {
    case "hydrating":
      return {
        title: "Offline clip",
        detail: "Media hydration is still running in the background.",
      };
    case "placeholder":
      return {
        title: "No video linked",
        detail:
          "This clip is a placeholder with no video linked yet. Attach or relink video to show it here.",
      };
    default:
      return {
        title: "Offline clip",
        detail:
          "This clip is in the project, but its media file is not cached locally yet.",
      };
  }
}
