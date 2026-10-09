import { CheckIcon } from "@heroicons/react/24/solid";
import { useSyncExternalStore } from "react";
import { effectMediaPath } from "../../../fx/effect-media.ts";
import { BUNDLED_LUTS } from "../../../fx/effects/lut/bundled.ts";
import {
  customLutMediaPath,
  customLutValue,
  describeLut,
  isNoLut,
  NO_LUT,
} from "../../../fx/effects/lut/lut.ts";
import {
  findLutMedia,
  getLutError,
  getLutMedia,
  getLutMediaVersion,
  subscribeLutMedia,
} from "../../../fx/effects/lut/lut-media.ts";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import type { FxParameterControlProps } from "../types";
import "./lut-control.css";

// Re-renders when the session's LUT media change or one finishes loading.
function useLutMedia() {
  useSyncExternalStore(subscribeLutMedia, getLutMediaVersion);
  return getLutMedia();
}

function MenuItem({
  checked,
  label,
  badge,
  onPick,
}: {
  checked: boolean;
  label: string;
  badge?: string;
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
      {badge ? <span className="fx-lut__badge">{badge}</span> : null}
    </DropdownMenuCheckboxItem>
  );
}

// A button naming the current LUT that opens a menu of None, the bundled
// LUTs and the session's .cube media. Each pick is one undo step. A custom
// LUT whose file is offline or was rejected is flagged, and grades nothing.
export function LutControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const media = useLutMedia();
  const value = parameter.stringValue ?? NO_LUT;
  const selectedPath = customLutMediaPath(value);
  const selectedMedia = findLutMedia(selectedPath);
  const set = (next: string) => {
    if (next !== value) {
      onSetParameter(device, parameter.key, next, "commit");
    }
  };
  const error = selectedPath ? getLutError(value) : undefined;
  const problem = selectedPath
    ? error
      ? `Can't use this LUT: ${error}`
      : selectedMedia?.availability !== "ready"
        ? "This LUT's file is offline."
        : undefined
    : undefined;

  return (
    <div className="fx-lut">
      <span className="fx-lut__label">{parameter.label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`${parameter.label}: ${describeLut(value)}`}
            className={[
              "fx-layers__trigger",
              "fx-lut__trigger",
              problem ? "is-offline" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-fx-no-drag
            title={problem ?? describeLut(value)}
            type="button"
          >
            {describeLut(value)}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="fx-layers-menu"
          sideOffset={4}
        >
          <MenuItem
            checked={isNoLut(value)}
            label={NO_LUT}
            onPick={() => set(NO_LUT)}
          />
          {BUNDLED_LUTS.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="fx-lut__heading">
                Looks
              </DropdownMenuLabel>
              {BUNDLED_LUTS.map((entry) => (
                <MenuItem
                  checked={
                    value.trim().toLowerCase() === entry.name.toLowerCase()
                  }
                  key={entry.name}
                  label={entry.name}
                  onPick={() => set(entry.name)}
                />
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="fx-lut__heading">
            Media
          </DropdownMenuLabel>
          {media.length ? (
            media.map((item) => {
              const path = effectMediaPath(item);
              return (
                <MenuItem
                  badge={
                    item.lastError
                      ? "Invalid"
                      : item.availability === "offline"
                        ? "Offline"
                        : undefined
                  }
                  checked={item === selectedMedia}
                  key={item.id}
                  label={item.name}
                  onPick={() => set(customLutValue(path))}
                />
              );
            })
          ) : (
            <p className="fx-lut__empty">
              Import a .cube file as media to use it here.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
