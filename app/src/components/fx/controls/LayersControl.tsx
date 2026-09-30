import { CheckIcon } from "@heroicons/react/24/solid";
import { parseLayerIdList, toggleLayerId } from "../../../composition-order";
import { describeArrangedLayers, excludeAllLayers } from "../../../fx-chain";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import type { FxParameterControlProps } from "../types";

// A button that opens a checkmark menu of `layers`: ticked layers are the
// ones the Order arranges. The parameter stores the unticked ones. Each
// toggle is one undo step and leaves the menu open for the next.
export function LayersControl({
  device,
  parameter,
  layers,
  onSetParameter,
}: FxParameterControlProps) {
  const value = parameter.stringValue ?? "";
  const excluded = new Set(parseLayerIdList(value));
  const excludedCount = layers.filter((layer) => excluded.has(layer.id)).length;
  const set = (next: string) => {
    if (next !== value) {
      onSetParameter(device, parameter.key, next, "commit");
    }
  };
  // Menu rows toggle in place instead of closing the menu.
  const keepOpen = (event: Event) => event.preventDefault();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="fx-layers__trigger" data-fx-no-drag type="button">
          {describeArrangedLayers(value, layers)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="fx-layers-menu"
        sideOffset={4}
      >
        {layers.map((layer) => (
          <DropdownMenuCheckboxItem
            checked={!excluded.has(layer.id)}
            className="fx-layers-menu__item"
            key={layer.id}
            onCheckedChange={() => set(toggleLayerId(value, layer.id))}
            onSelect={keepOpen}
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
        {layers.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          className="fx-layers-menu__item"
          disabled={!excludedCount}
          onSelect={(event) => {
            keepOpen(event);
            set("");
          }}
        >
          Include all
        </DropdownMenuItem>
        <DropdownMenuItem
          className="fx-layers-menu__item"
          disabled={!layers.length || excludedCount === layers.length}
          onSelect={(event) => {
            keepOpen(event);
            set(excludeAllLayers(layers));
          }}
        >
          Exclude all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
