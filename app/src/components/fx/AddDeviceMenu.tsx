import { PlusIcon } from "@heroicons/react/24/solid";
import type { FxEffectDefinition } from "../../fx-registry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export function AddDeviceMenu({
  effects,
  focusKey,
  label,
  withLabel,
  onAdd,
  onCloseAutoFocus,
  onOpen,
}: {
  effects: readonly FxEffectDefinition[];
  focusKey: string;
  label: string;
  withLabel: boolean;
  onAdd: (effectName: string) => void;
  onCloseAutoFocus: (event: Event) => void;
  onOpen: () => void;
}) {
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
          className={`fx-chain__add ${withLabel ? "fx-chain__add--labeled" : ""}`}
          data-fx-focus={focusKey}
          title={label}
          type="button"
        >
          <PlusIcon aria-hidden="true" />
          {withLabel ? <span>Add device</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="fx-add-menu"
        onCloseAutoFocus={onCloseAutoFocus}
        sideOffset={6}
      >
        {effects.map((definition) => (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
