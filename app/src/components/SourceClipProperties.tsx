import type { CSSProperties } from "react";
import type { SourceClipPropertiesModel } from "../hooks/useSourceClipProperties.ts";
import {
  SOURCE_CLIP_FIELD_LABELS,
  SOURCE_CLIP_FIELDS,
} from "../source-clip-properties.ts";
import { TimeValueControl } from "./ui/TimeValueControl";
import "./fx/fx-chain.css";
import "./source-clip-properties.css";

type SourceClipPropertiesProps = { model: SourceClipPropertiesModel };

// The selected source clip's Start, Length and Offset, in one device-style
// widget like a canned effect: no power, animation or add menu.
export function SourceClipProperties({ model }: SourceClipPropertiesProps) {
  const { accent, clipName, format, limits, mediaOffline, setField, values } =
    model;

  return (
    <div className="fx-chain source-clip-properties">
      <section
        aria-label={`${clipName} properties`}
        className="fx-device-panel source-clip-properties__device"
        style={{ "--fx-accent": accent } as CSSProperties}
      >
        <header className="fx-device-panel__title">
          <span className="fx-device-panel__name">Clip</span>
        </header>
        {mediaOffline ? (
          <p className="fx-device-panel__warning" role="status">
            Media offline: Length and Offset can't grow past their current
            values.
          </p>
        ) : null}
        <div className="fx-device-panel__body source-clip-properties__fields">
          {SOURCE_CLIP_FIELDS.map((field) => (
            <TimeValueControl
              key={field}
              {...format}
              accent={accent}
              kind={field === "start" ? "position" : "duration"}
              label={SOURCE_CLIP_FIELD_LABELS[field]}
              max={limits[field].max}
              min={limits[field].min}
              onChange={(value, { commit }) => setField(field, value, commit)}
              value={values[field]}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
