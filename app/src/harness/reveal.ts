import type { Harness, SaveTarget } from "./contracts";

// Whether the harness can show a saved export in the system file manager.
// Only native path saves can be revealed: browser downloads and file picker
// handles have no path to open.
export function canRevealSavedFile(
  harness: Pick<Harness, "capabilities" | "revealSavedFile"> | undefined,
  target: SaveTarget | null | undefined,
): target is Extract<SaveTarget, { kind: "native-path" }> {
  return Boolean(
    harness?.capabilities["reveal-saved-file"] &&
      harness.revealSavedFile &&
      target?.kind === "native-path",
  );
}
