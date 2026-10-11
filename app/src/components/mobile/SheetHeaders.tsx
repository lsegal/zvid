import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  PhotoIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { useEffect, useRef } from "react";
import { fxSheetAfterDrag } from "../../app/sheet-drag.ts";
import type {
  FxSheetHeight,
  FxSheetScreen,
  MobileShell,
} from "../../hooks/useMobileShell.ts";
import { useSheetDrag } from "../../hooks/useSheetDrag.ts";
import type { MediaDrawerTab } from "../media/media-drawer-model.ts";

type FxSheetHeaderProps = {
  title: string;
  height: FxSheetHeight;
  screen: FxSheetScreen;
  onHeightChange: (height: FxSheetHeight) => void;
  onScreenChange: (screen: FxSheetScreen) => void;
  onClose: () => void;
};

// The FX sheet's header: its grabber, which a tap toggles between half and
// full height, the selected layer or clip, the Devices | Animation screens
// and Close. Dragging anywhere on the header moves the sheet: it follows
// the finger, then settles at half or full height or closes.
export function FxSheetHeader({
  title,
  height,
  screen,
  onHeightChange,
  onScreenChange,
  onClose,
}: FxSheetHeaderProps) {
  const nextHeight = height === "half" ? "full" : "half";
  const HeightIcon =
    height === "half" ? ArrowsPointingOutIcon : ArrowsPointingInIcon;
  const headerRef = useRef<HTMLDivElement>(null);
  const startHeight = useRef<number | null>(null);
  // The sheet follows the finger without easing; let go, it eases to its
  // height, or slides away from where it was dropped.
  const drag = useSheetDrag({
    onMove(dy) {
      const sheet = headerRef.current?.parentElement;
      if (!sheet) {
        return;
      }
      startHeight.current ??= sheet.getBoundingClientRect().height;
      const next = Math.min(startHeight.current - dy, window.innerHeight);
      sheet.style.transition = "none";
      sheet.style.height = `${Math.max(next, 0)}px`;
    },
    onRelease(dy) {
      const sheet = headerRef.current?.parentElement;
      startHeight.current = null;
      const next = fxSheetAfterDrag(height, dy, window.innerHeight);
      if (next === null) {
        onClose();
        return;
      }
      if (sheet) {
        sheet.style.transition = "";
        sheet.style.height = "";
      }
      if (next !== height) {
        onHeightChange(next);
      }
    },
  });
  // A sheet dragged closed keeps its dropped height until it's gone.
  useEffect(() => {
    const sheet = headerRef.current?.parentElement;
    return () => {
      sheet?.style.removeProperty("transition");
      sheet?.style.removeProperty("height");
    };
  }, []);
  return (
    <div className="mobile-sheet-header" ref={headerRef} {...drag}>
      <button
        aria-label={height === "half" ? "Expand FX" : "Shrink FX"}
        className="mobile-sheet-header__grabber"
        onClick={() => onHeightChange(nextHeight)}
        type="button"
      >
        <span aria-hidden="true" className="mobile-sheet__grabber" />
      </button>
      <div className="mobile-sheet-header__row">
        <strong className="mobile-sheet-header__title">{title}</strong>
        <button
          aria-label={height === "half" ? "Full height" : "Half height"}
          className="mobile-icon-button"
          onClick={() => onHeightChange(nextHeight)}
          type="button"
        >
          <HeightIcon aria-hidden="true" />
        </button>
        <button
          aria-label="Close FX"
          className="mobile-icon-button"
          onClick={onClose}
          type="button"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </div>
      <fieldset aria-label="FX screen" className="mobile-segmented">
        {(
          [
            ["devices", "Devices"],
            ["motion", "Animation"],
          ] as const
        ).map(([id, label]) => (
          <button
            aria-pressed={screen === id}
            className={screen === id ? "is-active" : ""}
            key={id}
            onClick={() => onScreenChange(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

// The FX sheet's header while the sheet is open.
export function PhoneFxSheetHeader({
  mobile,
  title,
}: {
  mobile: MobileShell;
  title: string;
}) {
  if (!mobile.fxSheetShown) {
    return null;
  }
  return (
    <FxSheetHeader
      height={mobile.fxSheetShown}
      onClose={() => mobile.setFxSheet(null)}
      onHeightChange={mobile.setFxSheet}
      onScreenChange={mobile.setFxScreen}
      screen={mobile.fxScreen}
      title={title}
    />
  );
}

const MEDIA_TABS: [MediaDrawerTab, string][] = [
  ["sessions", "Sessions"],
  ["media", "Media"],
  ["record", "Record"],
];

type MediaSheetHeaderProps = {
  // Sliding away with the sheet after it closed.
  closing?: boolean;
  tab: MediaDrawerTab;
  onSelectTab: (tab: MediaDrawerTab) => void;
  onImport: () => void;
  onClose: () => void;
};

// The full-screen Media sheet's header: its Sessions | Media | Record tabs,
// import from the camera roll, and Close.
export function MediaSheetHeader({
  closing = false,
  tab,
  onSelectTab,
  onImport,
  onClose,
}: MediaSheetHeaderProps) {
  return (
    <div
      aria-hidden={closing || undefined}
      className={`mobile-media-header${closing ? " is-closing" : ""}`}
      inert={closing}
    >
      <fieldset aria-label="Media drawer" className="mobile-segmented">
        {MEDIA_TABS.map(([id, label]) => (
          <button
            aria-pressed={tab === id}
            className={tab === id ? "is-active" : ""}
            key={id}
            onClick={() => tab !== id && onSelectTab(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </fieldset>
      <button className="mobile-pill-button" onClick={onImport} type="button">
        <PhotoIcon aria-hidden="true" />
        <span>Camera roll</span>
      </button>
      <button
        aria-label="Close media"
        className="mobile-icon-button"
        onClick={onClose}
        type="button"
      >
        <XMarkIcon aria-hidden="true" />
      </button>
    </div>
  );
}
