import { Select } from "../../ui/select";
import type { FxParameterControlProps } from "../types";

export function EnumControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  // Long option lists, such as font weights, pick from a menu instead.
  if (parameter.menu) {
    return (
      <div className="fx-select">
        <span className="fx-select__label">{parameter.label}</span>
        <Select
          aria-label={parameter.label}
          data-fx-no-drag
          onValueChange={(value) =>
            onSetParameter(device, parameter.key, value, "commit")
          }
          options={(parameter.options ?? []).map((option) => ({
            value: option,
            label: option,
          }))}
          value={parameter.stringValue ?? ""}
        />
      </div>
    );
  }

  return (
    <fieldset className="fx-segmented">
      <legend>{parameter.label}</legend>
      <div className="fx-segmented__options">
        {parameter.options?.map((option) => (
          <button
            aria-pressed={parameter.stringValue === option}
            key={option}
            onClick={() =>
              onSetParameter(device, parameter.key, option, "commit")
            }
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
