import { PlusIcon } from "@heroicons/react/24/solid";
import { groupAddableEffects } from "../../fx-chain";
import type { FxEffectDefinition } from "../../fx-registry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import "./add-device-menu.css";

export function AddDeviceMenu({
  effects,
  focusKey,
  label,
  onAdd,
  onCloseAutoFocus,
  onOpen,
}: {
  effects: readonly FxEffectDefinition[];
  focusKey: string;
  label: string;
  onAdd: (effectName: string) => void;
  onCloseAutoFocus: (event: Event) => void;
  onOpen: () => void;
}) {
  // Video and audio effects each get a heading once both are offered.
  const groups = groupAddableEffects(effects);
  const labelled = groups.length > 1;
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          aria-label={label}
          className="fx-chain__add"
          data-fx-focus={focusKey}
          title={label}
          type="button"
        >
          <PlusIcon aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="fx-add-menu"
        onCloseAutoFocus={onCloseAutoFocus}
        sideOffset={6}
      >
        {groups.map((group, index) => (
          <DropdownMenuGroup
            aria-labelledby={
              labelled ? `${focusKey}-${group.domain}` : undefined
            }
            key={group.domain}
          >
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {labelled ? (
              <DropdownMenuLabel
                className="fx-add-menu__group"
                id={`${focusKey}-${group.domain}`}
              >
                {group.label}
              </DropdownMenuLabel>
            ) : null}
            {group.effects.map((definition) => (
              <DropdownMenuItem
                key={definition.effectName}
                onSelect={() => onAdd(definition.effectName)}
              >
                <span
                  aria-hidden="true"
                  className="fx-add-menu__swatch"
                  style={{ background: definition.accent }}
                />
                <span className="fx-add-menu__text">
                  <strong>{definition.displayName}</strong>
                  <span>{definition.description}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
