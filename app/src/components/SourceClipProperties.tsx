import {
  ChevronLeftIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/solid";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { SourceClipPropertiesModel } from "../hooks/useSourceClipProperties.ts";
import {
  SOURCE_CLIP_FIELD_LABELS,
  SOURCE_CLIP_FIELDS,
} from "../source-clip-properties.ts";
import { TimeValueControl } from "./ui/TimeValueControl";
import "./fx/fx-chain.css";
import "./source-clip-properties.css";

type SourceClipPropertiesProps = {
  model: SourceClipPropertiesModel;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

// The selected source clip's Start, Length and Offset, in one device-style
// widget like a canned effect: an info icon where effects have power and
// animation, no add menu, and it folds to a strip like a device. It leads the
// FX chain, ahead of the Global, Track and Clip sections.
export function SourceClipProperties({
  model,
  collapsed,
  onToggleCollapsed,
}: SourceClipPropertiesProps) {
  const { accent, clipName, format, limits, mediaOffline, setField, values } =
    model;
  const label = `${clipName} properties`;
  const style = { "--fx-accent": accent } as CSSProperties;
  const info = (
    <span className="source-clip-properties__info">
      <InformationCircleIcon aria-hidden="true" />
    </span>
  );

  if (collapsed) {
    return (
      <section
        aria-label={label}
        className="fx-device-panel fx-device-panel--collapsed source-clip-properties source-clip-properties__device"
        style={style}
      >
        {info}
        <button
          aria-expanded={false}
          aria-label="Expand Clip"
          className="fx-device-panel__strip"
          onClick={onToggleCollapsed}
          title="Expand Clip"
          type="button"
        >
          <span>Clip</span>
        </button>
      </section>
    );
  }

  // Double-clicking the title bar folds the widget, except on its buttons.
  function handleTitleDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    if (!(event.target as HTMLElement).closest("button")) {
      onToggleCollapsed();
    }
  }

  return (
    <section
      aria-label={label}
      className="fx-device-panel source-clip-properties source-clip-properties__device"
      style={style}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the collapse button is its keyboard equivalent */}
      <header
        className="fx-device-panel__title"
        onDoubleClick={handleTitleDoubleClick}
      >
        {info}
        <span className="fx-device-panel__name">Clip</span>
        <button
          aria-expanded
          aria-label="Collapse Clip"
          className="fx-device-panel__collapse"
          onClick={onToggleCollapsed}
          title="Collapse Clip"
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </button>
      </header>
      {mediaOffline ? (
        <p className="fx-device-panel__warning" role="status">
          Media offline: Length and Offset can't grow past their current values.
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
  );
}
