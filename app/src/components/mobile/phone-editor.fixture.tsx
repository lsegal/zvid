import { useMemo, useRef, useState } from "react";
import type { ArrangementClip, Lane, TimeSignature } from "../../app/types.ts";
import { SILENT_AUDIO_MIX } from "../../audio-mix/resolve.ts";
import type { CompositionPlayerHandle } from "../../CompositionPlayer";
import { PhoneShell } from "../../component-test/shells.tsx";
import type { MasterMeterTap } from "../../fx-shaders/audio-bands";
import { type SessionEffect, setEffectAnimation } from "../../fx-stack";
import { useFxPanelModel } from "../../hooks/useFxPanelModel.ts";
import { useMediaDrawer } from "../../hooks/useMediaDrawer.ts";
import { useMediaPreview } from "../../hooks/useMediaPreview.ts";
import { useMobileShell } from "../../hooks/useMobileShell.ts";
import type { SessionLibraryState } from "../../hooks/useSessionLibrary.ts";
import { useShellKind } from "../../hooks/useShellKind.ts";
import { createPlayheadSignal } from "../../playhead-signal";
import {
  readLayerTransform,
  readLayerTransformPosition,
} from "../../preview-edit.ts";
import type { StatusMessage } from "../../status-bar";
import type { TimeValueFormat } from "../../time-value.ts";
import { FxPanel } from "../FxPanel";
import { MediaDrawer } from "../media/MediaDrawer";
import { PreviewPanel, type PreviewPanelProps } from "../PreviewPanel";
import { StatusBar } from "../StatusBar";
import type { MobileShareButtonProps } from "./MobileShareButton";
import { MobileShellChrome } from "./MobileShellChrome";
import { PhoneFxSheetHeader } from "./SheetHeaders";

// The phone editor as App lays it out (#1177, #1211, #1218), for component
// tests of the phone shell's stylesheets: MobileShellChrome around the
// Media drawer, a timeline, the preview and the FX sheet, in the shell's
// grid. The timeline is a bare .timeline-panel, which is all the shell's
// grid places. Edits other than an effect's Animation are no-ops.

const noop = () => {};

const SIGNATURE: TimeSignature = { id: "sig", numerator: 4, denominator: 4 };
const TIME_FORMAT = {
  timelineMode: "musical",
  bpm: 120,
  signature: SIGNATURE,
  fps: 30,
} satisfies TimeValueFormat;

export type FixtureSession = {
  lanes: Lane[];
  effects: SessionEffect[];
  clips: ArrangementClip[];
  selectedClipId?: string;
};

export const EMPTY_SESSION: FixtureSession = {
  lanes: [{ id: "1", name: "Layer 1", colorIndex: 0 }],
  effects: [],
  clips: [],
};

// The FX panel for `session`'s selected clip and layer, as App builds it.
export function FixtureFxPanel({
  session,
  sheetHeader,
}: {
  session: FixtureSession;
  sheetHeader?: (title: string) => React.ReactNode;
}) {
  const [effects, setEffects] = useState(session.effects);
  const selectedClip = session.clips.find(
    (clip) => clip.id === session.selectedClipId,
  );
  const mediaItemsById = useMemo(() => new Map(), []);
  const lanePriority = useMemo(
    () => new Map(session.lanes.map((lane, index) => [lane.id, index])),
    [session.lanes],
  );
  const model = useFxPanelModel({
    lanes: session.lanes,
    effects,
    selectedLaneId: selectedClip?.laneId ?? session.lanes[0]?.id,
    selectedClip,
    sourceSelection: undefined,
    sourceTracks: [],
    sourceSpans: [],
    mediaItemsById,
    lanePriority,
    timelineClips: session.clips,
    playheadQ: 0,
    bpm: 120,
  });
  return (
    <FxPanel
      {...model}
      addFxDevice={noop}
      clearFxDevices={noop}
      copyFxDevice={noop}
      cutFxDevice={noop}
      duplicateFxDevice={noop}
      fxClipboard={null}
      isInspectorCollapsed={false}
      moveFxDevice={noop}
      moveFxDeviceToStack={noop}
      pasteFxDevice={noop}
      removeFxDevice={noop}
      resetFxDevice={noop}
      setFxDeviceAnimation={(device, animation) =>
        setEffects((current) =>
          setEffectAnimation(current, device.id, animation),
        )
      }
      setFxDeviceAnimationEnabled={noop}
      setFxDeviceEnabled={noop}
      setFxDeviceModulation={noop}
      setFxDeviceModulationEnabled={noop}
      setFxDeviceParameter={noop}
      setLayerFxEnabled={noop}
      setSourceTrackFxEnabled={noop}
      setMidiClipNotes={noop}
      setMidiClipTimeline={noop}
      sheetHeader={sheetHeader?.(model.fxPanelTitle)}
      sourceClip={null}
      toggleInspectorCollapsed={noop}
    />
  );
}

const share = {
  collaboration: {
    collaborationMode: "idle",
    collaborationView: { stateLabel: "", stateTone: "idle" },
    hasCopiedShareInvite: false,
    isStartingShare: false,
    setIsDiagnosticsDialogOpen: noop,
    setIsShareDialogOpen: noop,
    shareUrl: null,
  },
  sharing: {
    handleDisconnectConnection: noop,
    handleStopShare: noop,
    showShareCopiedBadge: noop,
  },
} as unknown as MobileShareButtonProps;

type PhoneEditorProps = {
  session?: FixtureSession;
  // Shows the preview panel, with its composition player, and any props
  // given here in place of its empty program's.
  preview?: boolean | Partial<PreviewPanelProps>;
  status?: StatusMessage;
  // The program mix the transport's VU meter reads while playing.
  getMeterTap?: () => MasterMeterTap | null;
  isPlaying?: boolean;
};

export function PhoneEditor({
  session = EMPTY_SESSION,
  preview = false,
  status,
  getMeterTap = () => null,
  isPlaying = false,
}: PhoneEditorProps) {
  const mediaDrawer = useMediaDrawer({ editorGridWidth: 412 });
  const [isAudioRowCollapsed, setAudioRowCollapsed] = useState(true);
  const mobile = useMobileShell({
    isPhone: true,
    isMediaDrawerOpen: mediaDrawer.isOpen,
    setMediaDrawerOpen: mediaDrawer.setOpen,
    openMediaTab: () => mediaDrawer.selectTab("media"),
    isAudioRowCollapsed,
    setAudioRowCollapsed,
  });
  // As usePhoneShell classes the shell, for the viewport's shell kind.
  const shell = useShellKind();
  const className = [
    shell === "phone-landscape" ? "app-shell--phone-landscape" : "",
    mobile.fxSheetShown ? `app-shell--fx-${mobile.fxSheetShown}` : "",
    mobile.isFxSheetClosing ? "app-shell--fx-closing" : "",
    `app-shell--fx-${mobile.fxScreen}`,
  ]
    .filter(Boolean)
    .join(" ");
  const [playheadSignal] = useState(() => createPlayheadSignal());
  return (
    <PhoneShell className={className}>
      <MobileShellChrome
        clipMenuEntries={[]}
        exportSupport="supported"
        getMeterTap={getMeterTap}
        getOverflowEntries={() => []}
        hasSelectedClip={false}
        hasSelection={false}
        historyEntries={[]}
        importMedia={() => undefined}
        isExporting={false}
        isLooping={false}
        isPlaying={isPlaying}
        isRecording={false}
        mediaDrawer={mediaDrawer}
        mobile={mobile}
        openClipMenu={noop}
        openExportDialog={noop}
        openSelectionMenu={noop}
        playheadSignal={playheadSignal}
        readout={TIME_FORMAT}
        record={noop}
        selectionMenuEntries={[]}
        sessionName="Session"
        share={share}
        skipToStart={noop}
        toggleLoop={noop}
        togglePlay={noop}
      />
      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <div className="editor-grid">
              <MediaDrawer
                drawer={mediaDrawer}
                library={{} as SessionLibraryState}
                mediaItems={[]}
                onBackfillMediaDetails={noop}
                onImport={noop}
                onOpenMedia={noop}
                prefersReducedMotion={false}
                remoteMediaProgress={new Map()}
                timeFormat={TIME_FORMAT}
              />
              <section className="timeline-panel" />
              {preview ? (
                <FixturePreviewPanel {...(preview === true ? {} : preview)} />
              ) : null}
            </div>
          </section>
          <FixtureFxPanel
            session={session}
            sheetHeader={(title) => (
              <PhoneFxSheetHeader mobile={mobile} title={title} />
            )}
          />
        </div>
      </main>
      <StatusBar items={[]} message={status} />
    </PhoneShell>
  );
}

// The preview panel with an empty program, unless `props` says otherwise.
function FixturePreviewPanel(props: Partial<PreviewPanelProps>) {
  const compositionPlayerRef = useRef<CompositionPlayerHandle | null>(null);
  const [playheadSignal] = useState(() => createPlayheadSignal());
  const mediaItemsById = useMemo(() => new Map(), []);
  const mediaPreview = useMediaPreview({
    isPlaying: false,
    setIsPlaying: noop,
    mediaItemsById,
    drawerMediaId: undefined,
  });
  return (
    <PreviewPanel
      activatePreviewLayer={noop}
      audioMix={SILENT_AUDIO_MIX}
      bpm={120}
      canvasHeight={1080}
      canvasWidth={1920}
      commitPreviewWidth={noop}
      compositionPlayerRef={compositionPlayerRef}
      effectivePreviewWidth={480}
      fps={30}
      getPreviewLayerPosition={(target) =>
        readLayerTransformPosition([], target.laneId)
      }
      getPreviewLayerTransform={(target) =>
        readLayerTransform([], target.laneId)
      }
      handlePreviewResizeKeyDown={noop}
      handlePreviewResizePointerDown={noop}
      handlePreviewResizePointerEnd={noop}
      handlePreviewResizePointerMove={noop}
      hasOnlinePlayheadClip={false}
      isPlaying={false}
      isTimelineAudibleScrubbing={false}
      mediaItems={[]}
      mediaPreview={mediaPreview}
      mediaRange={{ setPoint: noop, clear: noop }}
      mediaTimeFormat={TIME_FORMAT}
      movePreviewLayer={noop}
      playheadSignal={playheadSignal}
      previewClip={undefined}
      previewLaneId={undefined}
      previewLayers={[]}
      previewMaxWidth={960}
      previewMediaState="online"
      previewTextEdit={undefined}
      previewVolume={{ volume: 1, muted: false }}
      projectDurationFrames={undefined}
      renderClips={[]}
      renderEffects={[]}
      renderFromSourceTracks={false}
      renderLanes={[]}
      resolvePreviewLayersAt={() => []}
      selectPreviewLayer={noop}
      selectedClip={undefined}
      textEdit={undefined}
      timelineDragState={null}
      transformPreviewLayer={noop}
      {...props}
    />
  );
}
