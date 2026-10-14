import { EllipsisHorizontalIcon } from "@heroicons/react/20/solid";
import { CheckIcon } from "@heroicons/react/24/solid";
import {
  type DragEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { effectMediaPath } from "../../../fx/effect-media.ts";
import {
  DRUM_BANKS,
  DRUM_PAD_COUNT,
  FIRST_PAD_NOTE,
} from "../../../fx/effects/drum-rack/banks.ts";
import {
  drumRackParams,
  findDrumSampleMedia,
  getDrumSampleMedia,
  getDrumSampleMediaVersion,
  importDrumSample,
  subscribeDrumSampleMedia,
} from "../../../fx/effects/drum-rack/drum-media.ts";
import {
  type DrumRackSettings,
  drumPadFileName,
  drumRackBank,
  formatDrumRack,
  parseDrumRack,
  withDrumBank,
  withDrumPad,
} from "../../../fx/effects/drum-rack/drum-rack.ts";
import { getDraggedMediaIds, isMediaDrag } from "../../../media-drag.ts";
import { auditionDrumPad } from "../../../midi-audition.ts";
import { pitchName } from "../../../midi-piano-roll.ts";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import type { FxParameterControlProps } from "../types";
import "./drum-rack-control.css";

// How long a pressed pad stays lit.
const HIT_FLASH_MS = 160;

// The pads row by row from the top, as on a pad controller: pad 1 sits at
// the bottom left and pad 16 at the top right.
const PAD_ROWS = Array.from({ length: DRUM_PAD_COUNT / 4 }, (_, row) =>
  Array.from({ length: 4 }, (_, column) => (3 - row) * 4 + column),
);

// Re-renders when the session's audio media change.
function useDrumSampleMedia() {
  useSyncExternalStore(subscribeDrumSampleMedia, getDrumSampleMediaVersion);
  return getDrumSampleMedia();
}

// Lights pads for a moment each time they are pressed.
function useHitFlash() {
  const [lit, setLit] = useState<ReadonlySet<number>>(() => new Set());
  const timers = useRef(new Map<number, number>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);
  return {
    lit,
    flash(pad: number) {
      setLit((current) => new Set(current).add(pad));
      window.clearTimeout(timers.current.get(pad));
      timers.current.set(
        pad,
        window.setTimeout(() => {
          timers.current.delete(pad);
          setLit((current) => {
            const next = new Set(current);
            next.delete(pad);
            return next;
          });
        }, HIT_FLASH_MS),
      );
    },
  };
}

function CheckItem({
  checked,
  label,
  onPick,
}: {
  checked: boolean;
  label: string;
  onPick: () => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      className="fx-layers-menu__item"
      onCheckedChange={onPick}
    >
      <span className="fx-layers-menu__check">
        <DropdownMenuItemIndicator>
          <CheckIcon aria-hidden="true" />
        </DropdownMenuItemIndicator>
      </span>
      <span className="fx-layers-menu__name">{label}</span>
    </DropdownMenuCheckboxItem>
  );
}

// A Drum Rack's bank menu over its 4x4 pads. Pressing a pad plays its
// sample and lights it. A pad's menu, or a file or media dropped on it,
// loads its own sample from the media library in place of the bank's;
// picking a bank sets every pad back to that bank's samples. Each change is
// one undo step. A pad whose own sample is offline is flagged and silent.
export function DrumRackControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const media = useDrumSampleMedia();
  const value = parameter.stringValue ?? "";
  const settings = parseDrumRack(value);
  const bank = drumRackBank(settings);
  const params = drumRackParams(settings);
  const { lit, flash } = useHitFlash();
  const [dropPad, setDropPad] = useState<number>();

  const set = (next: DrumRackSettings) => {
    const formatted = formatDrumRack(next);
    if (formatted !== value) {
      onSetParameter(device, parameter.key, formatted, "commit");
    }
  };
  const press = (pad: number) => {
    flash(pad);
    void auditionDrumPad(pad, params);
  };
  const load = async (pad: number, files?: readonly File[]) => {
    const path = await importDrumSample(files);
    if (path) {
      set(withDrumPad(settings, pad, path));
    }
  };
  const acceptsDrop = (event: DragEvent) =>
    isMediaDrag(event.dataTransfer) ||
    Array.from(event.dataTransfer.types).includes("Files");
  const drop = (pad: number, event: DragEvent) => {
    event.preventDefault();
    setDropPad(undefined);
    const [id] = getDraggedMediaIds(event.dataTransfer);
    if (id) {
      const item = media.find((candidate) => candidate.id === id);
      if (item) {
        set(withDrumPad(settings, pad, effectMediaPath(item)));
      }
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      void load(pad, files);
    }
  };

  return (
    <div className="fx-drum-rack">
      <div className="fx-drum-rack__header">
        <span className="fx-drum-rack__label">Bank</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Bank: ${bank.name}`}
              className="fx-layers__trigger fx-drum-rack__bank"
              data-fx-no-drag
              type="button"
            >
              {bank.name}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="fx-layers-menu"
            sideOffset={4}
          >
            {DRUM_BANKS.map((entry) => (
              <CheckItem
                checked={entry === bank}
                key={entry.id}
                label={entry.name}
                onPick={() => set(withDrumBank(settings, entry))}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <fieldset className="fx-drum-rack__pads" aria-label="Pads">
        {PAD_ROWS.flat().map((pad) => {
          const path = settings.pads[pad];
          const offline = !!path && !params.samples[pad];
          const name = path ? drumPadFileName(path) : bank.pads[pad].name;
          const note = pitchName(FIRST_PAD_NOTE + pad);
          const custom = path ? findDrumSampleMedia(path) : undefined;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: dropping a file or media on a pad is a pointer shortcut; the pad's menu loads the same samples from the keyboard
            <div
              className={[
                "fx-drum-pad",
                path ? "is-custom" : "",
                offline ? "is-offline" : "",
                lit.has(pad) ? "is-hit" : "",
                dropPad === pad ? "is-drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-fx-no-drag
              key={pad}
              onDragLeave={() => setDropPad(undefined)}
              onDragOver={(event) => {
                if (acceptsDrop(event)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropPad(pad);
                }
              }}
              onDrop={(event) => drop(pad, event)}
            >
              <button
                aria-label={`Pad ${pad + 1}: ${name}`}
                className="fx-drum-pad__hit"
                data-hit={lit.has(pad) ? "" : undefined}
                onClick={(event) => {
                  // Keyboard and assistive presses; a pointer plays on
                  // its press, without waiting for the release.
                  if (event.detail === 0) {
                    press(pad);
                  }
                }}
                onPointerDown={(event) => {
                  if (event.button === 0) {
                    press(pad);
                  }
                }}
                title={
                  offline
                    ? `This pad's sample, ${name}, is offline.`
                    : `${name} (${note})`
                }
                type="button"
              >
                <span className="fx-drum-pad__name">{name}</span>
                <span className="fx-drum-pad__note">
                  {pad + 1} · {note}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`Pad ${pad + 1} sample`}
                    className="fx-drum-pad__menu"
                    type="button"
                  >
                    <EllipsisHorizontalIcon aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="fx-layers-menu"
                  sideOffset={4}
                >
                  <DropdownMenuItem
                    className="fx-layers-menu__item fx-drum-rack__menu-action"
                    onSelect={() => void load(pad)}
                  >
                    Load file…
                  </DropdownMenuItem>
                  <CheckItem
                    checked={!path}
                    label={`${bank.name}: ${bank.pads[pad].name}`}
                    onPick={() => set(withDrumPad(settings, pad, undefined))}
                  />
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="fx-lut__heading">
                    Media
                  </DropdownMenuLabel>
                  {media.length ? (
                    media.map((item) => (
                      <CheckItem
                        checked={item === custom}
                        key={item.id}
                        label={item.name}
                        onPick={() =>
                          set(withDrumPad(settings, pad, effectMediaPath(item)))
                        }
                      />
                    ))
                  ) : (
                    <p className="fx-lut__empty">
                      Import audio as media, or load a file, to play it here.
                    </p>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}
