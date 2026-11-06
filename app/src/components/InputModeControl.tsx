import { type ReactNode, useId, useSyncExternalStore } from "react";
import {
  type ComputerKeyboardEntry,
  computerKeyboardEntry,
} from "../midi-input/computer-keyboard.ts";
import { type MidiInputHub, midiInputHub } from "../midi-input/input-hub.ts";
import type { KeyMapControls } from "./fx/key-map-context";
import "./input-mode-control.css";

type InputMap = Pick<KeyMapControls, "active" | "toggle">;
type InputMode = "off" | "on" | "map";

const KEY_GLYPH = (
  <>
    <rect height="12" rx="2" width="19" x="2.5" y="6" />
    <path d="M6.5 10h.01M10.2 10h.01M13.8 10h.01M17.5 10h.01M8 14h8" />
  </>
);

// A musical keyboard: three white keys and the two black keys between them.
const MIDI_GLYPH = (
  <>
    <rect height="14" rx="2" width="19" x="2.5" y="5" />
    <path d="M8.83 13v6M15.17 13v6" />
    <path
      d="M7.75 5h2.17v7a1 1 0 0 1-1 1h-.17a1 1 0 0 1-1-1zM14.08 5h2.17v7a1 1 0 0 1-1 1h-.17a1 1 0 0 1-1-1z"
      fill="currentColor"
    />
  </>
);

function InputIcon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

// The glyph cut in two by a slash, whatever the background behind it.
function BrokenInputIcon({ children }: { children: ReactNode }) {
  const maskId = useId();
  return (
    <InputIcon>
      <mask id={maskId}>
        <rect fill="#fff" height="24" width="24" />
        <path d="M4 2 22 20" stroke="#000" strokeWidth="6" />
      </mask>
      <g mask={`url(#${maskId})`}>{children}</g>
      <path d="M3 3l18 18" />
    </InputIcon>
  );
}

// One input's two segments: off on the left, and on the right a toggle between
// on and map that, from off, turns the input on.
function InputModeSegments({
  name,
  glyph,
  mode,
  onTitle,
  mapTitle,
  onOff,
  onToggle,
}: {
  name: string;
  glyph: ReactNode;
  mode: InputMode;
  onTitle: string;
  mapTitle: string;
  onOff: () => void;
  onToggle: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset's legend and box don't suit a toolbar's button pair.
    <div
      aria-label={`${name} input`}
      className="input-mode"
      data-mode={mode}
      role="group"
    >
      <button
        aria-label={`${name} off`}
        aria-pressed={mode === "off"}
        className="input-mode__segment input-mode__segment--off"
        onClick={onOff}
        title={`Turn ${name} off`}
        type="button"
      >
        <BrokenInputIcon>{glyph}</BrokenInputIcon>
      </button>
      <button
        aria-label={mode === "map" ? `${name} map` : `${name} on`}
        aria-pressed={mode !== "off"}
        className="input-mode__segment input-mode__segment--input"
        onClick={onToggle}
        title={
          mode === "off"
            ? `Turn ${name} on`
            : mode === "on"
              ? onTitle
              : mapTitle
        }
        type="button"
      >
        <InputIcon>{glyph}</InputIcon>
      </button>
    </div>
  );
}

// The typing keyboard's control. On, it plays a piano roll's notes and presses
// mapped effect buttons; off, it does neither.
export function KeyInputControl({
  entry = computerKeyboardEntry,
  map,
}: {
  entry?: ComputerKeyboardEntry;
  map: InputMap;
}) {
  const { enabled } = useSyncExternalStore(entry.subscribe, entry.getState);
  return (
    <InputModeSegments
      glyph={KEY_GLYPH}
      mapTitle="Key map: click an effect button, then press a key. Click to stop mapping."
      mode={map.active ? "map" : enabled ? "on" : "off"}
      name="Key"
      onOff={() => {
        if (map.active) {
          map.toggle();
        }
        entry.setEnabled(false);
      }}
      onTitle="Key on: keys play piano rolls (Z and X shift the octave) and press mapped effect buttons. Click to map keys."
      onToggle={() => {
        if (enabled) {
          map.toggle();
        } else {
          entry.setEnabled(true);
        }
      }}
    />
  );
}

// The MIDI control. On, the hub delivers keys to piano rolls and mapped effect
// buttons; off, it delivers nothing. Turning it on asks for MIDI access.
export function MidiInputControl({
  hub = midiInputHub,
  map,
}: {
  hub?: MidiInputHub;
  map: InputMap;
}) {
  const { enabled } = useSyncExternalStore(hub.subscribe, hub.getState);
  return (
    <InputModeSegments
      glyph={MIDI_GLYPH}
      mapTitle="MIDI map: click an effect button, then press a MIDI key. Click to stop mapping."
      mode={map.active ? "map" : enabled ? "on" : "off"}
      name="MIDI"
      onOff={() => {
        if (map.active) {
          map.toggle();
        }
        hub.setEnabled(false);
      }}
      onTitle="MIDI on: MIDI keys play piano rolls and press mapped effect buttons. Click to map MIDI keys."
      onToggle={() => {
        if (enabled) {
          map.toggle();
        } else {
          hub.setEnabled(true);
        }
      }}
    />
  );
}
