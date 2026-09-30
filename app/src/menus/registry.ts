// Menus are assembled from small entry providers, one per feature, so adding
// an item means adding a provider instead of editing a shared builder.
import type { ContextMenuEntry } from "../context-menu.ts";

export type MenuEntryProvider<Context> = {
  id: string;
  // Where the provider's entries go; menus list providers by ascending order.
  order: number;
  entries: (context: Context) => readonly ContextMenuEntry[];
};

/** The entries of `providers`, in ascending `order`, for `context`. */
export function assembleMenu<Context>(
  providers: readonly MenuEntryProvider<Context>[],
  context: Context,
): ContextMenuEntry[] {
  return [...providers]
    .sort((a, b) => a.order - b.order)
    .flatMap((provider) => provider.entries(context));
}

/** A provider for a separator between groups of entries. */
export function menuSeparator<Context>(
  id: string,
  order: number,
): MenuEntryProvider<Context> {
  return { id, order, entries: () => [{ type: "separator" }] };
}
