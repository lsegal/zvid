import { toggleStyleFlag } from "../../../text-style";
import { useKeyMapControls } from "../key-map-context";
import type { FxParameterControlProps } from "../types";

export function FlagsControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const keyMap = useKeyMapControls();
  const value = parameter.stringValue ?? "";
  const on = new Set(value.split(","));
  return (
    <fieldset className="fx-segmented fx-flags">
      <legend>{parameter.label}</legend>
      <div className="fx-segmented__options">
        {parameter.flags?.map((flag) => (
          <button
            aria-label={flag.title}
            aria-pressed={on.has(flag.value)}
            className={`fx-flags__${flag.value.toLowerCase()}`}
            key={flag.value}
            onClick={() =>
              onSetParameter(
                device,
                parameter.key,
                toggleStyleFlag(value, flag.value),
                "commit",
              )
            }
            title={flag.title}
            type="button"
            {...keyMap.buttonProps({
              kind: "flag",
              effectId: device.id,
              parameter: parameter.key,
              value: flag.value,
            })}
          >
            {flag.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
