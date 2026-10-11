import type { MobileShellChromeProps } from "../../hooks/usePhoneShell.ts";
import { useSheetPresence } from "../../hooks/useSheetPresence.ts";
import { MobileRangeToolbar } from "./MobileRangeToolbar";
import { MobileSelectionToolbar } from "./MobileSelectionToolbar";
import { MobileTabBar } from "./MobileTabBar";
import { MobileTopBar } from "./MobileTopBar";
import { MobileTransport } from "./MobileTransport";
import { MediaSheetHeader } from "./SheetHeaders";
import "./mobile-shell.css";
import "./mobile-panels.css";
import "./mobile-sheet-motion.css";
import "./mobile-timeline.css";

// The phone shell's own controls around the editor's panels, which its
// stylesheet lays out preview first: the top bar, the thin transport, the
// clip or lane selection's toolbar, the bottom tabs and the Media sheet's header.
export function MobileShellChrome({
  mobile,
  sessionName,
  exportSupport,
  isExporting,
  openExportDialog,
  getOverflowEntries,
  historyEntries,
  share,
  mediaDrawer,
  importMedia,
  playheadSignal,
  readout,
  getMeterTap,
  isPlaying,
  isRecording,
  isLooping,
  togglePlay,
  skipToStart,
  record,
  toggleLoop,
  hasSelectedClip,
  clipMenuEntries,
  openClipMenu,
  hasSelection,
  selectionMenuEntries,
  openSelectionMenu,
}: MobileShellChromeProps) {
  // The header slides away with the Media sheet under it.
  const mediaHeader = useSheetPresence(mediaDrawer.isOpen);
  return (
    <>
      <MobileTopBar
        exportSupport={exportSupport}
        getMenuEntries={getOverflowEntries}
        historyEntries={historyEntries}
        isExporting={isExporting}
        isMenuOpen={mobile.isMenuOpen}
        onExport={openExportDialog}
        onOpenSessions={() => mediaDrawer.selectTab("sessions")}
        sessionName={sessionName}
        setIsMenuOpen={mobile.setIsMenuOpen}
        share={share}
      />
      <MobileTransport
        {...readout}
        getMeterTap={getMeterTap}
        isLooping={isLooping}
        isPlaying={isPlaying}
        isRecording={isRecording}
        onRecord={record}
        onSkipToStart={skipToStart}
        onToggleLoop={toggleLoop}
        onTogglePlay={togglePlay}
        playheadSignal={playheadSignal}
      />
      {hasSelectedClip ? (
        <MobileSelectionToolbar
          entries={clipMenuEntries}
          onOpenFx={mobile.openFxSheet}
          onOpenMenu={openClipMenu}
        />
      ) : hasSelection ? (
        <MobileRangeToolbar
          entries={selectionMenuEntries}
          onOpenMenu={openSelectionMenu}
        />
      ) : null}
      <MobileTabBar
        activeTab={mobile.activeTab}
        isAudioShown={mobile.isAudioShown}
        onSelect={mobile.selectTab}
      />
      {mediaHeader.present ? (
        <MediaSheetHeader
          closing={mediaHeader.closing}
          key={mediaHeader.key}
          onClose={() => mediaDrawer.setOpen(false)}
          onImport={importMedia}
          onSelectTab={mediaDrawer.selectTab}
          tab={mediaDrawer.tab}
        />
      ) : null}
    </>
  );
}
