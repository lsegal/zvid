import { useEffect, useSyncExternalStore } from "react";
import {
  type ComputerKeyboardEntry,
  computerKeyboardKey,
} from "../../midi-input/computer-keyboard.ts";
import { NEW_NOTE_VELOCITY } from "../../midi-piano-roll.ts";
import { hasOpenPopup, isTextEntryTarget } from "../../space-shortcut";

const HELD_KEY_PREFIX = "computer-keyboard:";

// Keys typed here belong to what's focused: text fields, a native select,
// and dialogs, along with any open menu or listbox.
function keepsTypedKeys(target: EventTarget | null) {
  const element = target as Element | null;
  return (
    isTextEntryTarget(target) ||
    element?.tagName === "SELECT" ||
    Boolean(element?.closest?.('[role="dialog"], [role="alertdialog"]')) ||
    hasOpenPopup(document)
  );
}

// Plays the piano roll from the typing keyboard while `active`. The window's
// capture phase gets each note key before the shortcuts, which suspends any
// plain letter shortcut it collides with, and mapped keys (see useKeyMap.ts)
// ask `claimsKey`; every other key, and any key with a modifier down, carries
// on as usual. A held key plays one note, ending when it comes
// up, when the window loses focus or when entry goes off. Returns the entry's
// state.
export function useComputerKeyboardEntry({
  active,
  entry,
  press,
  release,
}: {
  active: boolean;
  entry: ComputerKeyboardEntry;
  press: (heldKey: string, pitch: number, velocity: number) => void;
  release: (heldKey: string) => void;
}) {
  const state = useSyncExternalStore(entry.subscribe, entry.getState);
  const listening = active && state.enabled;

  useEffect(() => {
    if (!listening) {
      return undefined;
    }
    const stopClaiming = entry.claimKeys();
    const pressed = new Set<string>();
    const releaseAll = () => {
      for (const code of pressed) {
        release(`${HELD_KEY_PREFIX}${code}`);
      }
      pressed.clear();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // macOS sends no keyup for keys released while Cmd is down.
      if (event.key === "Meta") {
        releaseAll();
        return;
      }
      const key = computerKeyboardKey(event.code);
      if (
        !key ||
        !entry.claimsKey(event) ||
        // Key Map mode just took it, to map it to an effect button.
        event.defaultPrevented ||
        keepsTypedKeys(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) {
        return;
      }
      if (key.kind === "octave") {
        entry.shiftOctave(key.direction);
        return;
      }
      pressed.add(event.code);
      press(
        `${HELD_KEY_PREFIX}${event.code}`,
        entry.getState().basePitch + key.offset,
        NEW_NOTE_VELOCITY,
      );
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (pressed.delete(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        release(`${HELD_KEY_PREFIX}${event.code}`);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
      stopClaiming();
    };
  }, [listening, entry, press, release]);

  return state;
}
