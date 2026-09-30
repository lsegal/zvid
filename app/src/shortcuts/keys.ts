export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

/**
 * Whether `event` presses `spec`, a key name with optional modifiers such as
 * `Mod+C`, `Mod+Shift+Z` or `ArrowLeft`. Keys compare case-insensitively.
 * - `Mod` is Ctrl or Cmd; Alt does not matter alongside it.
 * - Without `Mod`, Ctrl, Cmd and Alt must all be up.
 * - `Shift` must be down when named; otherwise it does not matter.
 * - `Any` matches whatever modifiers are down.
 */
export function matchesShortcutKey(spec: string, event: ShortcutKeyEvent) {
  const parts = spec.split("+");
  const key = parts.pop() ?? "";
  if (event.key.toLowerCase() !== key.toLowerCase()) {
    return false;
  }

  if (parts.includes("Any")) {
    return true;
  }

  const hasPrimaryModifier = event.metaKey || event.ctrlKey;
  if (parts.includes("Mod")) {
    if (!hasPrimaryModifier) {
      return false;
    }
  } else if (hasPrimaryModifier || event.altKey) {
    return false;
  }

  return !parts.includes("Shift") || event.shiftKey;
}
