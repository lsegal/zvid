import type { MobileShellChromeProps } from "../../hooks/usePhoneShell.ts";
import { MobileSelectionToolbar } from "./MobileSelectionToolbar";
import { MobileTabBar } from "./MobileTabBar";
import { MobileTopBar } from "./MobileTopBar";
import { MobileTransport } from "./MobileTransport";
import { MediaSheetHeader } from "./SheetHeaders";
import "./mobile-shell.css";

// The phone shell's own controls around the editor's panels, which its
// stylesheet lays out preview first: the top bar, the thin transport, the
// selection toolbar, the bottom tabs and the Media sheet's header.
export function MobileShellChrome({
  mobile,
  sessionName,
  exportSupport,
  isExporting,
  openExportDialog,
  getOverflowEntries,
  mediaDrawer,
  importMedia,
  playheadSignal,
  readout,
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
}: MobileShellChromeProps) {
  return (
    <>
      <MobileTopBar
        exportSupport={exportSupport}
        getMenuEntries={getOverflowEntries}
        isExporting={isExporting}
        isMenuOpen={mobile.isMenuOpen}
        onExport={openExportDialog}
        onOpenSessions={() => mediaDrawer.selectTab("sessions")}
        sessionName={sessionName}
        setIsMenuOpen={mobile.setIsMenuOpen}
      />
      <MobileTransport
        {...readout}
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
          isTrimming={mobile.isTrimming}
          onOpenFx={mobile.openFxSheet}
          onOpenMenu={openClipMenu}
          onToggleTrim={() => mobile.setIsTrimming(!mobile.isTrimming)}
        />
      ) : null}
      <MobileTabBar
        activeTab={mobile.activeTab}
        isAudioShown={mobile.isAudioShown}
        onSelect={mobile.selectTab}
      />
      {mediaDrawer.isOpen ? (
        <MediaSheetHeader
          onClose={() => mediaDrawer.setOpen(false)}
          onImport={importMedia}
          onSelectTab={mediaDrawer.selectTab}
          tab={mediaDrawer.tab}
        />
      ) : null}
    </>
  );
}
