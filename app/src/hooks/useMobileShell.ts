import { useEffect, useState } from "react";

export type FxSheetHeight = "half" | "full";
// The FX sheet's two screens: the devices and their settings, and the
// Animation and Modulation sections attached to them.
export type FxSheetScreen = "devices" | "motion";
export type MobileTab = "media" | "edit" | "fx" | "audio";

export type MobileShellInputs = {
  isPhone: boolean;
  selectedClipId: string | undefined;
  isMediaDrawerOpen: boolean;
  setMediaDrawerOpen: (open: boolean) => void;
  openMediaTab: () => void;
  isAudioRowCollapsed: boolean;
  setAudioRowCollapsed: (collapsed: boolean) => void;
};

// The mobile shell's own view state: which sheet is open and how tall, the
// Reorder and source-track toggles, and the selected clip's trim mode. The
// Media sheet is the Media drawer, so it keeps the drawer's open state.
export function useMobileShell({
  isPhone,
  selectedClipId,
  isMediaDrawerOpen,
  setMediaDrawerOpen,
  openMediaTab,
  isAudioRowCollapsed,
  setAudioRowCollapsed,
}: MobileShellInputs) {
  const [fxSheet, setFxSheet] = useState<FxSheetHeight | null>(null);
  const [fxScreen, setFxScreen] = useState<FxSheetScreen>("devices");
  const [isReordering, setIsReordering] = useState(false);
  const [showsSourceTracks, setShowsSourceTracks] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Trim mode belongs to the clip it was turned on for.
  useEffect(() => {
    void selectedClipId;
    setIsTrimming(false);
  }, [selectedClipId]);

  const isMediaOpen = isPhone && isMediaDrawerOpen;
  const activeTab: MobileTab = isMediaOpen ? "media" : fxSheet ? "fx" : "edit";

  function openFxSheet() {
    setMediaDrawerOpen(false);
    setFxScreen("devices");
    setFxSheet((height) => height ?? "half");
  }

  function selectTab(tab: MobileTab) {
    switch (tab) {
      case "media":
        setFxSheet(null);
        if (!isMediaOpen) {
          openMediaTab();
        }
        return;
      case "fx":
        if (fxSheet) {
          setFxSheet(null);
        } else {
          openFxSheet();
        }
        return;
      case "audio":
        setAudioRowCollapsed(!isAudioRowCollapsed);
        return;
      case "edit":
        setFxSheet(null);
        setMediaDrawerOpen(false);
        return;
    }
  }

  return {
    activeTab,
    selectTab,
    isAudioShown: !isAudioRowCollapsed,
    fxSheet,
    setFxSheet,
    fxScreen,
    setFxScreen,
    openFxSheet,
    isReordering,
    setIsReordering,
    showsSourceTracks,
    setShowsSourceTracks,
    isTrimming,
    setIsTrimming,
    isMenuOpen,
    setIsMenuOpen,
  };
}

export type MobileShell = ReturnType<typeof useMobileShell>;
