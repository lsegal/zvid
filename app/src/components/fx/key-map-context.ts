import { createContext, useContext } from "react";
import type { KeyMapTarget } from "../../key-map.ts";
import type { MidiKnobTarget } from "../../midi-map.ts";

// What a mappable button adds to itself while mapping: it reads as mappable,
// shows its key, and a press selects it instead of activating it.
export type KeyMapButtonProps = {
  "aria-keyshortcuts"?: string;
  "data-key-map"?: "mappable" | "selected";
  "data-key-map-key"?: string;
  onClickCapture?: (event: { stopPropagation: () => void }) => void;
  onDoubleClickCapture?: (event: { stopPropagation: () => void }) => void;
  onPointerDownCapture?: (event: { stopPropagation: () => void }) => void;
};

export type KeyMapControls = {
  // Whether mapping mode is on.
  active: boolean;
  toggle: () => void;
  // Spread on a mappable button; nothing while mapping mode is off.
  buttonProps: (target: KeyMapTarget) => KeyMapButtonProps;
  // Spread on a knob or fader; nothing unless MIDI Map mode is on.
  knobProps: (target: MidiKnobTarget) => KeyMapButtonProps;
  // Whether a mapped key is holding this Drum Rack pad down.
  isPadHeld: (effectId: string, pad: number) => boolean;
};

const NO_BUTTON_PROPS: KeyMapButtonProps = {};

export const INACTIVE_KEY_MAP: KeyMapControls = {
  active: false,
  toggle: () => {},
  buttonProps: () => NO_BUTTON_PROPS,
  knobProps: () => NO_BUTTON_PROPS,
  isPadHeld: () => false,
};

export const KeyMapContext = createContext(INACTIVE_KEY_MAP);

export function useKeyMapControls() {
  return useContext(KeyMapContext);
}

// MIDI Map mode's switch, for the phone's piano roll header.
export const MidiMapContext =
  createContext<Pick<KeyMapControls, "active" | "toggle">>(INACTIVE_KEY_MAP);
