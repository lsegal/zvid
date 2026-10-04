import { useState } from "react";
import {
  findShape,
  SHAPES,
  type ShapeDefinition,
} from "../../../fx/effects/shape/shapes/index.ts";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import type { FxParameterControlProps } from "../types";
import "./shape-control.css";

// The shape drawn black on white, as the mask it makes.
function ShapePreview({ shape }: { shape: ShapeDefinition }) {
  return (
    <svg aria-hidden="true" className="fx-shape__preview" viewBox="-8 -8 116 116">
      <rect fill="#fff" height="116" width="116" x="-8" y="-8" />
      <path d={shape.previewPath} fill="#000" />
    </svg>
  );
}

// A button showing the current shape that opens a grid of every shape to
// pick from. Each pick is one undo step and closes the grid.
export function ShapeControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const [open, setOpen] = useState(false);
  const current = findShape(parameter.stringValue);

  return (
    <div className="fx-shape">
      <span className="fx-shape__label">{parameter.label}</span>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={`${parameter.label}: ${current.name}`}
            className="fx-shape__trigger"
            data-fx-no-drag
            title={current.name}
            type="button"
          >
            <ShapePreview shape={current} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={`${parameter.label} options`}
          className="fx-shape__popover"
        >
          <div className="fx-shape__grid" role="listbox">
            {SHAPES.map((shape) => (
              <button
                aria-selected={shape === current}
                className="fx-shape__option"
                key={shape.name}
                onClick={() => {
                  if (shape !== current) {
                    onSetParameter(device, parameter.key, shape.name, "commit");
                  }
                  setOpen(false);
                }}
                role="option"
                title={shape.name}
                type="button"
              >
                <ShapePreview shape={shape} />
                <span>{shape.name}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
