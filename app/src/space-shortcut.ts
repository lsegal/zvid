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

// Open Radix menus and dialogs, where Space should activate the focused item.
// A listbox docked in the page, such as the Media drawer's (#681), is always
// present and is not an overlay, so it opts out with data-docked-listbox.
const OPEN_OVERLAY_SELECTOR =
  '[role="menu"], [role="listbox"]:not([data-docked-listbox]), [role="dialog"], [role="alertdialog"], [aria-modal="true"]';

// The top bar's menubar (#734) is always on the page, so it only claims Space
// while one of its triggers has focus.
const OVERLAY_SELECTOR = `${OPEN_OVERLAY_SELECTOR}, [role="menubar"]`;

// A layer header's or source track label's reorder grip picks up and drops
// its row with Space, as drag handles do (#478, #654). Every other control
// leaves Space to playback (#167).
const GRIP_SELECTOR = "[data-layer-grip], [data-source-track-grip]";

type SpaceTarget = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

type OverlayRoot = {
  querySelector: (selector: string) => unknown;
};

export type SpaceTargetKind = "text-entry" | "overlay" | "grip" | "playback";

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
// field, act on an open menu or dialog, or toggle playback.
export function classifySpaceTarget(
  target: unknown,
  root?: OverlayRoot | null,
): SpaceTargetKind {
  if (isTextEntryTarget(target)) {
    return "text-entry";
  }

  const element = target as SpaceTarget | null;
  if (
    typeof element?.closest === "function" &&
    element.closest(OVERLAY_SELECTOR)
  ) {
    return "overlay";
  }

  if (
    typeof element?.closest === "function" &&
    element.closest(GRIP_SELECTOR)
  ) {
    return "grip";
  }

  if (root?.querySelector(OPEN_OVERLAY_SELECTOR)) {
    return "overlay";
  }

  return "playback";
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
