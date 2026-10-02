// `<input>` types that accept typed text, so Space must insert a character
// instead of toggling playback. Everything else (range, checkbox, radio,
// button, color, file…) lets Space fall through to the transport.
const TEXT_INPUT_TYPES = new Set([
  "",
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

// Open menus, listboxes and popovers, which Space closes before it toggles
// playback. A listbox docked in the page, such as the Media drawer's (#681),
// is always present and stays open, so it opts out with data-docked-listbox.
const OPEN_POPUP_SELECTOR =
  '[role="menu"], [role="listbox"]:not([data-docked-listbox]), [data-radix-popper-content-wrapper]';

// A region that plays its own preview with Space, such as the Export
// dialog's, handles the key itself.
const OWN_PLAYBACK_SELECTOR = "[data-space-playback]";

type SpaceTarget = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

type PopupRoot = {
  querySelector: (selector: string) => unknown;
};

export type SpaceTargetKind = "text-entry" | "own-playback" | "playback";

export function isTextEntryTarget(target: unknown) {
  if (!target || typeof target !== "object") {
    return false;
  }

  const element = target as SpaceTarget;
  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName?.toUpperCase();
  if (tagName === "TEXTAREA") {
    return true;
  }

  return (
    tagName === "INPUT" &&
    TEXT_INPUT_TYPES.has((element.type ?? "").toLowerCase())
  );
}

// Decides what Space does for a keydown aimed at `target`: type into a text
// field, play a region's own preview, or toggle playback. Space never opens
// menus, presses buttons or picks up grips (#745).
export function classifySpaceTarget(target: unknown): SpaceTargetKind {
  if (isTextEntryTarget(target)) {
    return "text-entry";
  }

  const element = target as SpaceTarget | null;
  if (
    typeof element?.closest === "function" &&
    element.closest(OWN_PLAYBACK_SELECTOR)
  ) {
    return "own-playback";
  }

  return "playback";
}

// Whether a menu, listbox or popover is open, for Space to close first.
export function hasOpenPopup(root: PopupRoot | null | undefined) {
  return Boolean(root?.querySelector(OPEN_POPUP_SELECTOR));
}

// Tracks a held Space key so Space + left-drag can pan the timeline like a
// hand tool. Playback toggles on release, and only if no pan used the hold.
export function createSpaceHold() {
  let held = false;
  let panned = false;

  return {
    get held() {
      return held;
    },
    press() {
      if (!held) {
        held = true;
        panned = false;
      }
    },
    markPanned() {
      if (held) {
        panned = true;
      }
    },
    // Ends the hold and reports whether it should toggle playback.
    release() {
      const shouldToggle = held && !panned;
      held = false;
      panned = false;
      return shouldToggle;
    },
    cancel() {
      held = false;
      panned = false;
    },
  };
}
