// Which layout the editor uses. Phones get the touch-first mobile shell;
// tablets and anything with a mouse or trackpad keep the desktop layout.

export type ShellKind = "desktop" | "phone" | "phone-landscape";

// The widest a phone's shorter side gets. Tablets start at about 744px
// (iPad mini), so this leaves room for large phones held either way.
export const PHONE_MAX_SHORT_SIDE = 600;

export type ShellViewport = {
  width: number;
  height: number;
  // Whether the primary pointer is coarse, as `(pointer: coarse)` reports.
  coarsePointer: boolean;
};

/**
 * The shell for a viewport. It goes by pointer type as well as size, so a
 * narrow desktop window keeps the desktop layout, and a phone turned
 * sideways (wider than any breakpoint) keeps the mobile one.
 */
export function pickShellKind({
  width,
  height,
  coarsePointer,
}: ShellViewport): ShellKind {
  if (!coarsePointer || !(width > 0) || !(height > 0)) {
    return "desktop";
  }
  if (Math.min(width, height) > PHONE_MAX_SHORT_SIDE) {
    return "desktop";
  }
  return width > height ? "phone-landscape" : "phone";
}

export function isPhoneShell(shell: ShellKind) {
  return shell !== "desktop";
}
