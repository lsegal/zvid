import { ChevronRightIcon, PlusIcon } from "@heroicons/react/24/solid";
import { groupAddableEffects } from "../../fx-chain";
import type { FxEffectDefinition } from "../../fx-registry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  // Their categories open as submenus, unless the menu offers only one
  // category, whose effects are then listed directly.
  const groups = groupAddableEffects(effects);
  const labeled = groups.length > 1;
  const inline =
    groups.reduce((count, group) => count + group.categories.length, 0) <= 1;
  const item = (definition: FxEffectDefinition) => (
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
  );
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
              labeled ? `${focusKey}-${group.domain}` : undefined
            }
            key={group.domain}
          >
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {labeled ? (
              <DropdownMenuLabel
                className="fx-add-menu__group"
                id={`${focusKey}-${group.domain}`}
              >
                {group.label}
              </DropdownMenuLabel>
            ) : null}
            {inline
              ? group.effects.map(item)
              : group.categories.map((category) => (
                  <DropdownMenuSub key={category.category}>
                    <DropdownMenuSubTrigger className="fx-add-menu__category">
                      <span>{category.label}</span>
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="dropdown-menu-sub-chevron"
                      />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="fx-add-menu">
                      {category.effects.map(item)}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
