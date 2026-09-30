import type { FxParameterControlProps } from "../types";

export function EnumControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  // Long option lists, such as font weights, pick from a menu instead.
  if (parameter.menu) {
    return (
      <label className="fx-select">
        <span className="fx-select__label">{parameter.label}</span>
        <select
          data-fx-no-drag
          onChange={(event) =>
            onSetParameter(device, parameter.key, event.target.value, "commit")
          }
          value={parameter.stringValue}
        >
          {parameter.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
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
