import { CheckIcon } from "@heroicons/react/24/solid";
import { describeMaskTarget } from "../../../fx-chain";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import type { FxParameterControlProps } from "../types";

// A button that opens a menu of `layers` to pick exactly one from, or None.
// The parameter stores the picked layer's id, empty for None. Each pick is
// one undo step.
export function LayerControl({
  device,
  parameter,
  layers,
  onSetParameter,
}: FxParameterControlProps) {
  const value = parameter.stringValue?.trim() ?? "";
  const selected = layers.some((layer) => layer.id === value) ? value : "";
  const set = (next: string) => {
    if (next !== value) {
      onSetParameter(device, parameter.key, next, "commit");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={parameter.label}
          className="fx-layers__trigger"
          data-fx-no-drag
          type="button"
        >
          {describeMaskTarget(value, layers)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="fx-layers-menu"
        sideOffset={4}
      >
        <DropdownMenuCheckboxItem
          checked={!selected}
          className="fx-layers-menu__item"
          onCheckedChange={() => set("")}
        >
          <span className="fx-layers-menu__check">
            <DropdownMenuItemIndicator>
              <CheckIcon aria-hidden="true" />
            </DropdownMenuItemIndicator>
          </span>
          <span className="fx-layers-menu__name">None</span>
        </DropdownMenuCheckboxItem>
        {layers.length ? <DropdownMenuSeparator /> : null}
        {layers.map((layer) => (
          <DropdownMenuCheckboxItem
            checked={layer.id === selected}
            className="fx-layers-menu__item"
            key={layer.id}
            onCheckedChange={() => set(layer.id)}
          >
            <span className="fx-layers-menu__check">
              <DropdownMenuItemIndicator>
                <CheckIcon aria-hidden="true" />
              </DropdownMenuItemIndicator>
            </span>
            <span className="fx-layers-menu__number">{layer.number}</span>
            <span
              aria-hidden="true"
              className="fx-layers-menu__swatch"
              style={{ background: layer.color }}
            />
            <span className="fx-layers-menu__name">{layer.name}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
