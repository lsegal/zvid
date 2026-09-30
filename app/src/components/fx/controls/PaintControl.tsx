import { useRef } from "react";
import ColorPicker from "react-best-gradient-color-picker";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import type { FxParameterControlProps } from "../types";

// A swatch that opens a colour or gradient picker in a popover. Picker drags
// send transient edits, and closing the popover commits the last value as
// one undo step.
export function PaintControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const pendingRef = useRef<string | null>(null);
  const value = parameter.stringValue ?? `${parameter.defaultValue}`;
  const gradient = parameter.kind === "gradient";
  const label = `Edit ${parameter.label}`;

  return (
    <div className={`fx-paint${parameter.dimmed ? " fx-paint--dimmed" : ""}`}>
      <span className="fx-paint__label">{parameter.label}</span>
      <Popover
        onOpenChange={(open) => {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (!open && pending !== null) {
            onSetParameter(device, parameter.key, pending, "commit");
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={label}
            className="fx-paint__swatch"
            data-fx-no-drag
            title={label}
            type="button"
          >
            <span aria-hidden="true" style={{ background: value }} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="fx-paint__popover">
          <ColorPicker
            disableLightMode
            hideColorTypeBtns
            hideGradientControls={!gradient}
            height={150}
            onChange={(next) => {
              pendingRef.current = next;
              onSetParameter(device, parameter.key, next, "transient");
            }}
            value={value}
            width={236}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
