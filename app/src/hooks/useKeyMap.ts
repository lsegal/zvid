import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { patchProjectState } from "../app/session-project.ts";
import type { ProjectState } from "../app/types.ts";
import { isEditableEventTarget } from "../app/util.ts";
import type {
  KeyMapButtonProps,
  KeyMapControls,
} from "../components/fx/key-map-context.ts";
import { drumRackParams } from "../fx/effects/drum-rack/drum-media.ts";
import { parseDrumRack } from "../fx/effects/drum-rack/drum-rack.ts";
import type { SessionEffect } from "../fx-stack.ts";
import {
  assignKeyMapping,
  findKeyMapping,
  type KeyMapTarget,
  keyLabel,
  keyMapTargetId,
  mappableKey,
  pressKeyMapTarget,
  removeKeyMapping,
} from "../key-map.ts";
import { auditionDrumPad } from "../midi-audition.ts";
import { computerKeyboardEntry } from "../midi-input/computer-keyboard.ts";
import { hasOpenPopup } from "../space-shortcut.ts";

const NO_PADS: ReadonlySet<string> = new Set();
const NOT_MAPPING: KeyMapButtonProps = {};

function padId(effectId: string, pad: number) {
  return `${effectId}:${pad}`;
}

// A key press a menu or dialog should get, not a mapping.
function isKeyForPopup() {
  return (
    hasOpenPopup(document) ||
    Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'))
  );
}

export type KeyMapInputs = {
  effects: SessionEffect[];
  keyMappings: ProjectState["keyMappings"];
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  editEffects: (
    label: string,
    updater: (effects: SessionEffect[]) => SessionEffect[],
  ) => void;
  setStatus: (status: string) => void;
};

// Mapping mode and the mapped keys. Both listen on the window in the capture
// phase, ahead of the global shortcuts, a focused control and the shortcuts
// that listen on it, so a mapped key takes priority over them all. Space,
// Escape and Ctrl/Cmd combinations aren't mapped, so they carry on through.
export function useKeyMap({
  effects,
  keyMappings,
  commitProjectChange,
  editEffects,
  setStatus,
}: KeyMapInputs): KeyMapControls {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<KeyMapTarget | null>(null);
  const [heldPads, setHeldPads] = useState(NO_PADS);
  // The keys down that pressed a mapping, by code, so a release matches even
  // if Shift changed which character the key makes. Each has the pads it holds.
  const heldKeysRef = useRef(new Map<string, readonly string[]>());
  const selectedTarget =
    selected && effects.some((effect) => effect.id === selected.effectId)
      ? selected
      : null;

  const latestRef = useRef({
    active,
    selected: selectedTarget,
    effects,
    keyMappings,
    commitProjectChange,
    editEffects,
  });
  latestRef.current = {
    active,
    selected: selectedTarget,
    effects,
    keyMappings,
    commitProjectChange,
    editEffects,
  };

  const releaseHeldKeys = useCallback(() => {
    heldKeysRef.current.clear();
    setHeldPads(NO_PADS);
  }, []);

  useEffect(() => {
    const commitMappings = (
      label: string,
      update: (mappings: ProjectState["keyMappings"]) => typeof mappings,
    ) =>
      latestRef.current.commitProjectChange(label, (current) =>
        patchProjectState(current, {
          keyMappings: update(current.keyMappings),
        }),
      );

    const handleMappingKey = (event: KeyboardEvent, target: KeyMapTarget) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSelected(null);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          commitMappings("Remove Key Mapping", (mappings) =>
            removeKeyMapping(mappings, target),
          );
        }
        return;
      }
      const key = mappableKey(event);
      if (key === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        commitMappings("Map Key", (mappings) =>
          assignKeyMapping(mappings, target, key),
        );
      }
    };

    const pressMappedKey = (event: KeyboardEvent) => {
      // The piano roll is playing notes from the keyboard's letters.
      if (computerKeyboardEntry.claimsKey(event)) {
        return;
      }
      const { effects: current, keyMappings: mappings } = latestRef.current;
      const key = mappableKey(event);
      const presses =
        key === undefined
          ? []
          : (mappings ?? []).flatMap(({ key: mapped, target }) => {
              const press =
                mapped === key && pressKeyMapTarget(current, target);
              return press ? [{ press, target }] : [];
            });
      if (!presses.length) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // A held key doesn't retrigger through key repeat.
      const code = event.code || event.key;
      if (event.repeat || heldKeysRef.current.has(code)) {
        return;
      }

      const pads: string[] = [];
      for (const { press, target } of presses) {
        if (press.kind === "pad") {
          pads.push(padId(target.effectId, press.pad));
          void auditionDrumPad(
            press.pad,
            drumRackParams(parseDrumRack(press.settings)),
          );
        } else {
          // Each works from the edit before it, as separate clicks would.
          latestRef.current.editEffects(press.label, (effects) => {
            const next = pressKeyMapTarget(effects, target);
            return next?.kind === "edit" ? next.effects : effects;
          });
        }
      }
      heldKeysRef.current.set(code, pads);
      if (pads.length) {
        setHeldPads((held) => new Set([...held, ...pads]));
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target) || isKeyForPopup()) {
        return;
      }
      const { active: mapping, selected: target } = latestRef.current;
      if (!mapping) {
        pressMappedKey(event);
      } else if (target) {
        handleMappingKey(event, target);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const code = event.code || event.key;
      const pads = heldKeysRef.current.get(code);
      if (!pads) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      heldKeysRef.current.delete(code);
      if (pads.length) {
        const stillHeld = new Set([...heldKeysRef.current.values()].flat());
        setHeldPads((held) => {
          const next = new Set(held);
          for (const pad of pads) {
            if (!stillHeld.has(pad)) {
              next.delete(pad);
            }
          }
          return next;
        });
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", releaseHeldKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", releaseHeldKeys);
    };
  }, [releaseHeldKeys]);

  const toggle = useCallback(() => {
    const next = !latestRef.current.active;
    setActive(next);
    setSelected(null);
    releaseHeldKeys();
    setStatus(
      next
        ? "Key Map: click an effect button, then press a key. Delete removes its key, Esc cancels."
        : "Key Map off.",
    );
  }, [releaseHeldKeys, setStatus]);

  return useMemo(() => {
    const selectedId = selectedTarget && keyMapTargetId(selectedTarget);
    return {
      active,
      toggle,
      buttonProps: (target) => {
        if (!active) {
          return NOT_MAPPING;
        }
        const key = findKeyMapping(keyMappings, target)?.key;
        // Stops the press in the capture phase, so the button neither
        // activates nor starts a drag of its device.
        const swallow = (event: { stopPropagation: () => void }) =>
          event.stopPropagation();
        return {
          ...(key === undefined
            ? {}
            : { "aria-keyshortcuts": key, "data-key-map-key": keyLabel(key) }),
          "data-key-map":
            keyMapTargetId(target) === selectedId ? "selected" : "mappable",
          onClickCapture: (event) => {
            swallow(event);
            setSelected(target);
          },
          onPointerDownCapture: swallow,
        };
      },
      isPadHeld: (effectId, pad) => heldPads.has(padId(effectId, pad)),
    };
  }, [active, heldPads, keyMappings, selectedTarget, toggle]);
}
