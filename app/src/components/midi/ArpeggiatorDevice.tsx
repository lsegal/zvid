import {
  ChevronLeftIcon,
  PlusIcon,
  PowerIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { midiHistoryLabels } from "../../midi-editing.ts";
import type { SynthTrackModel } from "../../midi-panel-model.ts";
import {
  ARP_MAX_OCTAVES,
  ARP_PATTERNS,
  ARP_RATES,
  type ArpPattern,
  type ArpRate,
  type Arpeggiator,
  DEFAULT_ARPEGGIATOR,
} from "../../note-generators.ts";
import "../fx/fx-chain.css";
import "./midi-devices.css";

export type SetArpeggiator = (
  trackId: string,
  arp: Arpeggiator | undefined,
  label: string,
) => void;

type ArpeggiatorDeviceProps = {
  model: SynthTrackModel;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSet: SetArpeggiator;
};

const ACCENT = "#c7a6ff";

const RATE_LABELS: Record<ArpRate, string> = {
  1: "1/4",
  0.5: "1/8",
  0.25: "1/16",
  0.125: "1/32",
};

const PATTERN_LABELS: Record<ArpPattern, string> = {
  up: "Up",
  down: "Down",
  "up-down": "Up-Down",
  random: "Random",
};

const OCTAVES = Array.from({ length: ARP_MAX_OCTAVES }, (_, index) => index + 1);

// A source track's Arpeggiator, the note generator ahead of its Synth: on
// each step of its rate it plays one held note, walking the held chord in
// its pattern across its octaves. A track without one shows a strip that
// adds it; its power button bypasses it and its X removes it, either way
// leaving the clips' notes as they are.
export function ArpeggiatorDevice({
  model,
  collapsed,
  onToggleCollapsed,
  onSet,
}: ArpeggiatorDeviceProps) {
  const { trackId, trackName, arpeggiator: arp } = model;
  const label = `${trackName} arpeggiator`;
  const style = { "--fx-accent": ACCENT } as CSSProperties;

  if (!arp) {
    return (
      <section
        aria-label={label}
        className="fx-device-panel fx-device-panel--collapsed arp-device"
        style={style}
      >
        <button
          aria-label="Add Arpeggiator"
          className="fx-device-panel__strip"
          onClick={() =>
            onSet(trackId, DEFAULT_ARPEGGIATOR, midiHistoryLabels.addArpeggiator)
          }
          title="Add Arpeggiator"
          type="button"
        >
          <PlusIcon aria-hidden="true" className="arp-device__add-icon" />
          <span>Arp</span>
        </button>
      </section>
    );
  }

  const powerLabel = arp.enabled ? "Bypass Arpeggiator" : "Enable Arpeggiator";
  const power = (
    <button
      aria-label={powerLabel}
      aria-pressed={arp.enabled}
      className="fx-device-panel__power"
      onClick={() =>
        onSet(
          trackId,
          { ...arp, enabled: !arp.enabled },
          midiHistoryLabels.arpeggiatorEnabled(!arp.enabled),
        )
      }
      title={powerLabel}
      type="button"
    >
      <PowerIcon aria-hidden="true" />
    </button>
  );
  const className = [
    "fx-device-panel",
    collapsed ? "fx-device-panel--collapsed" : "",
    arp.enabled ? "" : "fx-device-panel--bypassed",
    "arp-device",
  ]
    .filter(Boolean)
    .join(" ");

  if (collapsed) {
    return (
      <section aria-label={label} className={className} style={style}>
        {power}
        <button
          aria-expanded={false}
          aria-label="Expand Arpeggiator"
          className="fx-device-panel__strip"
          onClick={onToggleCollapsed}
          title="Expand Arpeggiator"
          type="button"
        >
          <span>Arpeggiator</span>
        </button>
      </section>
    );
  }

  function handleTitleDoubleClick(event: ReactMouseEvent<HTMLElement>) {
    if (!(event.target as HTMLElement).closest("button")) {
      onToggleCollapsed();
    }
  }

  // A segmented choice of one setting, each option an undoable edit.
  function segmented<Value extends string | number>(
    legend: string,
    values: readonly Value[],
    current: Value,
    format: (value: Value) => string,
    apply: (value: Value) => Arpeggiator,
    historyLabel: string,
  ) {
    return (
      <fieldset className="fx-segmented">
        <legend>{legend}</legend>
        <div className="fx-segmented__options">
          {values.map((value) => (
            <button
              aria-pressed={current === value}
              key={value}
              onClick={() => {
                if (current !== value) {
                  onSet(trackId, apply(value), historyLabel);
                }
              }}
              type="button"
            >
              {format(value)}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <section aria-label={label} className={className} style={style}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the collapse button is its keyboard equivalent */}
      <header
        className="fx-device-panel__title"
        onDoubleClick={handleTitleDoubleClick}
      >
        {power}
        <span className="fx-device-panel__name">Arpeggiator</span>
        <button
          aria-label="Remove Arpeggiator"
          className="fx-device-panel__remove"
          onClick={() =>
            onSet(trackId, undefined, midiHistoryLabels.removeArpeggiator)
          }
          title="Remove Arpeggiator"
          type="button"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
        <button
          aria-expanded
          aria-label="Collapse Arpeggiator"
          className="fx-device-panel__collapse"
          onClick={onToggleCollapsed}
          title="Collapse Arpeggiator"
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </button>
      </header>
      <div className="fx-device-panel__body arp-device__body">
        {segmented(
          "Rate",
          ARP_RATES,
          arp.rate,
          (rate) => RATE_LABELS[rate],
          (rate) => ({ ...arp, rate }),
          midiHistoryLabels.arpeggiatorRate,
        )}
        {segmented(
          "Pattern",
          ARP_PATTERNS,
          arp.pattern,
          (pattern) => PATTERN_LABELS[pattern],
          (pattern) => ({ ...arp, pattern }),
          midiHistoryLabels.arpeggiatorPattern,
        )}
        {segmented(
          "Octaves",
          OCTAVES,
          arp.octaves,
          String,
          (octaves) => ({ ...arp, octaves }),
          midiHistoryLabels.arpeggiatorOctaves,
        )}
      </div>
    </section>
  );
}
