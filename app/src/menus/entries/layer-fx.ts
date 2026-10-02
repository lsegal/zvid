import type { ContextMenuEntry } from "../../context-menu.ts";
import { groupAddableEffects } from "../../fx-chain.ts";
import type { LayerMenuContext } from "../layer-menu.ts";
import type { MenuEntryProvider } from "../registry.ts";

// The layer-wide FX bypass, and Add FX with every effect a layer can take.
export const layerFxEntries: MenuEntryProvider<LayerMenuContext> = {
  id: "fx",
  order: 50,
  entries: ({ fxEnabled, effects, disabled, actions }) => [
    {
      type: "item",
      id: "toggle-fx",
      label: fxEnabled ? "Disable FX" : "Enable FX",
      disabled,
      onSelect: actions.toggleFx,
    },
    {
      type: "item",
      id: "add-fx",
      label: "Add FX",
      disabled: disabled || !effects.length,
      // Audio effects follow the video ones, after a separator.
      submenu: groupAddableEffects(effects).flatMap(
        (group, index): ContextMenuEntry[] => [
          ...(index > 0 ? [{ type: "separator" } as const] : []),
          ...group.effects.map(
            (definition): ContextMenuEntry => ({
              type: "item",
              id: `fx-${definition.effectName}`,
              label: definition.displayName,
              onSelect: () => actions.addFx(definition.effectName),
            }),
          ),
        ],
      ),
    },
  ],
};
