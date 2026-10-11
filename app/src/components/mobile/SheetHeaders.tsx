import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  PhotoIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import type {
  FxSheetHeight,
  FxSheetScreen,
  MobileShell,
} from "../../hooks/useMobileShell.ts";
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
// and Close.
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
  return (
    <div className="mobile-sheet-header">
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
  if (!mobile.fxSheet) {
    return null;
  }
  return (
    <FxSheetHeader
      height={mobile.fxSheet}
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
  tab: MediaDrawerTab;
  onSelectTab: (tab: MediaDrawerTab) => void;
  onImport: () => void;
  onClose: () => void;
};

// The full-screen Media sheet's header: its Sessions | Media | Record tabs,
// import from the camera roll, and Close.
export function MediaSheetHeader({
  tab,
  onSelectTab,
  onImport,
  onClose,
}: MediaSheetHeaderProps) {
  return (
    <div className="mobile-media-header">
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
