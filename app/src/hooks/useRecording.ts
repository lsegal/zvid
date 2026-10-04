import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { PALETTE } from "../app/constants.ts";
import { secondsToQuarters } from "../app/timeline-math.ts";
import type { ProjectState } from "../app/types.ts";
import { pluralize } from "../app/util.ts";
import type { ImportNoticeContent } from "../components/ImportNotice";
import { getHarness } from "../harness";
import type { MediaItem } from "../media";
import { LiveTakeMonitor } from "../recording/live-take-monitor.ts";
import {
  LiveTakeStore,
  recordingEndStepQ,
} from "../recording/live-take-store.ts";
import { useArmedTrackIds } from "../recording/record-arm.ts";
import { resolveTrackInputs } from "../recording/record-inputs.ts";
import {
  canPressRecord,
  playbackEndsRecording,
  pressRecord,
  type RecordPhase,
} from "../recording/record-transport.ts";
import {
  addRecordedTakes,
  remuxRecording,
} from "../recording/recorded-takes.ts";
import {
  type FinishedTake,
  getBrowserRecordingDeps,
  type RecordingDeps,
  RecordingSession,
} from "../recording/recording-session.ts";
import {
  type RecordedPass,
  saveRecordedTakes,
} from "../recording/save-recorded-takes.ts";

// How often the growing clips redraw, in milliseconds. Only the clips
// themselves follow this tick, through the pass's LiveTakeStore.
const LIVE_TICK_MS = 200;

// A track's clip while it records: where it starts, where to read how long
// it is so far, and what it has captured.
export type LiveTake = {
  trackId: string;
  startQ: number;
  store: LiveTakeStore;
  hasVideo: boolean;
  hasAudio: boolean;
  monitor: LiveTakeMonitor;
  // Set once the track stopped early or the pass is being saved.
  ended: boolean;
};

export type RecordingInputs = {
  sourceTracks: ProjectState["sourceTracks"];
  bpm: number;
  isPlaying: boolean;
  playheadQRef: { current: number };
  startPlayback: (fromQ?: number, options?: { open?: boolean }) => void;
  refuseReadOnlyEdit: () => boolean;
  commitProjectChange: (
    label: string,
    updater: (current: ProjectState) => ProjectState,
  ) => void;
  mediaItemCount: number;
  seedLocalMediaItems: (items: MediaItem[]) => void;
  cacheLocalMediaItems: (items: MediaItem[]) => Promise<void>;
  setSourceTracksCollapsed: (collapsed: boolean) => void;
  setStatus: Dispatch<SetStateAction<string>>;
  // Reports where the clips being recorded end, so the timeline makes room.
  // It moves a bar at a time.
  setRecordingEndQ: (endQ: number) => void;
  // The length of a bar, in quarters.
  barQuarters: number;
  // Stands in for the browser's MediaRecorder and mediaDevices in tests.
  deps?: RecordingDeps | null;
};

type ActivePass = RecordedPass & {
  session: RecordingSession;
  store: LiveTakeStore;
  // The last end reported to `setRecordingEndQ`.
  endQ: number;
  monitors: LiveTakeMonitor[];
  endedReasons: Map<string, string>;
};

// The transport's Record button: recording every armed source track from
// its inputs into clips that grow from the playhead while playback runs.
// Pressing Record again, or stopping playback, ends the pass and saves each
// take into the session's media like an import.
export function useRecording({
  sourceTracks,
  bpm,
  isPlaying,
  playheadQRef,
  startPlayback,
  refuseReadOnlyEdit,
  commitProjectChange,
  mediaItemCount,
  seedLocalMediaItems,
  cacheLocalMediaItems,
  setSourceTracksCollapsed,
  setStatus,
  setRecordingEndQ,
  barQuarters,
  deps,
}: RecordingInputs) {
  const armedTrackIds = useArmedTrackIds();
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [liveTakes, setLiveTakes] = useState<ReadonlyMap<string, LiveTake>>(
    () => new Map(),
  );
  // Reports the takes the last pass couldn't keep, until dismissed.
  const [failureNotice, setFailureNotice] =
    useState<ImportNoticeContent | null>(null);
  const passRef = useRef<ActivePass | null>(null);
  const sourceTracksRef = useRef(sourceTracks);
  sourceTracksRef.current = sourceTracks;

  const trackName = useCallback(
    (trackId: string) =>
      sourceTracksRef.current.find((track) => track.id === trackId)?.name ??
      "Source Track",
    [],
  );

  const saveTakes = useCallback(
    async (pass: ActivePass, finished: FinishedTake[]) => {
      setStatus(
        finished.length
          ? `Saving ${pluralize(finished.length, "recording")}...`
          : "Recording stopped before anything was captured.",
      );
      const { items, unanalyzed, failures } = await saveRecordedTakes(
        pass,
        finished,
        {
          trackName,
          hasTrack: (trackId) =>
            sourceTracksRef.current.some((track) => track.id === trackId),
          remux: remuxRecording,
          analyze: async (file, index) => {
            const [item] = await getHarness().analyzeMedia(
              { kind: "files", files: [file] },
              PALETTE,
              mediaItemCount + index,
            );
            return item;
          },
          createPreviewUrl: (file) => URL.createObjectURL(file),
          palettes: PALETTE,
          place: (placed) =>
            commitProjectChange("Record", (current) =>
              addRecordedTakes(current, placed),
            ),
        },
      );
      if (items.length) {
        seedLocalMediaItems(items);
        void cacheLocalMediaItems(items);
        setSourceTracksCollapsed(false);
      }
      setStatus(
        [
          items.length ? `Recorded ${pluralize(items.length, "clip")}.` : "",
          unanalyzed
            ? `${pluralize(unanalyzed, "clip")} couldn't be analyzed and will be analyzed again later.`
            : "",
          failures.length
            ? `Couldn't keep ${pluralize(failures.length, "recording")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setFailureNotice(
        failures.length
          ? {
              tone: "error",
              title: `Couldn't keep ${pluralize(failures.length, "recording")}`,
              lines: failures.map(
                ({ trackId, message }) => `${trackName(trackId)}: ${message}.`,
              ),
            }
          : null,
      );
    },
    [
      cacheLocalMediaItems,
      commitProjectChange,
      mediaItemCount,
      seedLocalMediaItems,
      setSourceTracksCollapsed,
      setStatus,
      trackName,
    ],
  );

  const stopRecording = useCallback(async () => {
    const pass = passRef.current;
    if (!pass) return;
    passRef.current = null;
    setPhase("saving");
    for (const trackId of pass.trackIds) pass.store.end(trackId);
    setLiveTakes((current) => markEnded(current, () => true));
    try {
      let finished: FinishedTake[];
      try {
        finished = await pass.session.stop();
      } catch (error) {
        console.warn("[zvid] Stopping the recorders failed.", error);
        finished = [];
        const message = error instanceof Error ? error.message : String(error);
        for (const trackId of pass.trackIds) {
          if (!pass.endedReasons.has(trackId)) {
            pass.endedReasons.set(trackId, message);
          }
        }
      }
      await saveTakes(pass, finished);
    } finally {
      for (const monitor of pass.monitors) monitor.dispose();
      setLiveTakes(new Map());
      setRecordingEndQ(0);
      setPhase("idle");
    }
  }, [saveTakes, setRecordingEndQ]);

  const startRecording = useCallback(async () => {
    if (phase !== "idle" || refuseReadOnlyEdit()) return;
    const trackIds = sourceTracksRef.current
      .map((track) => track.id)
      .filter((id) => armedTrackIds.has(id));
    if (!trackIds.length) return;
    const recordingDeps =
      deps === undefined
        ? getBrowserRecordingDeps((trackId, available) =>
            resolveTrackInputs(trackId, available),
          )
        : deps;
    if (!recordingDeps) {
      setStatus("This browser can't record from cameras or microphones.");
      return;
    }

    setPhase("starting");
    const { session, failures, skipped } = await RecordingSession.open(
      trackIds,
      recordingDeps,
      {
        onTrackEnded: (trackId, message) => {
          setStatus(`Stopped recording ${trackName(trackId)}: ${message}.`);
          passRef.current?.endedReasons.set(trackId, message);
          passRef.current?.store.end(trackId);
          setLiveTakes((current) =>
            markEnded(current, (take) => take.trackId === trackId),
          );
        },
      },
    );
    const problems = [
      ...failures.map(
        ({ trackId, message }) =>
          `Couldn't record ${trackName(trackId)}: ${message}.`,
      ),
      ...skipped.map(
        (trackId) =>
          `${trackName(trackId)} has no camera or microphone selected.`,
      ),
    ];
    if (session.isEmpty) {
      setPhase("idle");
      setStatus(problems.join(" ") || "Nothing to record.");
      return;
    }

    const startQ = playheadQRef.current;
    session.start();
    const store = new LiveTakeStore(
      session.getTakes().map((take) => take.trackId),
    );
    const takes = session.getTakes().map<LiveTake>((take) => ({
      trackId: take.trackId,
      startQ,
      store,
      hasVideo: take.hasVideo,
      hasAudio: take.hasAudio,
      monitor: new LiveTakeMonitor(take.stream, () => session.elapsedSeconds()),
      ended: false,
    }));
    passRef.current = {
      session,
      trackIds: takes.map((take) => take.trackId),
      startQ,
      startedAt: new Date(),
      store,
      endQ: 0,
      endedReasons: new Map(),
      monitors: takes.map((take) => take.monitor),
    };
    setLiveTakes(new Map(takes.map((take) => [take.trackId, take])));
    setPhase("recording");
    setSourceTracksCollapsed(false);
    // Playback starts at the playhead, or keeps playing from where it is,
    // and runs until stopped.
    startPlayback(startQ, { open: true });
    setStatus(
      [
        `Recording ${pluralize(session.getTakes().length, "track")}.`,
        ...problems,
      ].join(" "),
    );
  }, [
    armedTrackIds,
    deps,
    phase,
    playheadQRef,
    refuseReadOnlyEdit,
    setSourceTracksCollapsed,
    setStatus,
    startPlayback,
    trackName,
  ]);

  // Clips grow while their tracks record, without re-rendering the app; the
  // timeline makes room a bar at a time.
  useEffect(() => {
    if (phase !== "recording") return;
    const tick = () => {
      const pass = passRef.current;
      if (!pass) return;
      const elapsed = pass.session.elapsedSeconds();
      pass.store.advance(elapsed);
      const endQ = recordingEndStepQ(
        pass.startQ,
        secondsToQuarters(elapsed, bpm),
        barQuarters,
      );
      if (endQ !== pass.endQ) {
        pass.endQ = endQ;
        setRecordingEndQ(endQ);
      }
    };
    tick();
    const timer = window.setInterval(tick, LIVE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [barQuarters, bpm, phase, setRecordingEndQ]);

  // Stopping playback ends the recording too.
  useEffect(() => {
    if (playbackEndsRecording(phase, isPlaying)) {
      void stopRecording();
    }
  }, [isPlaying, phase, stopRecording]);

  // Leaving the editor mid-pass releases the devices.
  useEffect(
    () => () => {
      const pass = passRef.current;
      passRef.current = null;
      if (!pass) return;
      void pass.session.stop();
      for (const monitor of pass.monitors) monitor.dispose();
    },
    [],
  );

  const toggleRecording = useCallback(() => {
    const press = pressRecord(phase, armedTrackIds.size, isPlaying);
    if (press.action === "stop") {
      void stopRecording();
    } else if (press.action === "start") {
      void startRecording();
    }
  }, [armedTrackIds, isPlaying, phase, startRecording, stopRecording]);

  return {
    armedTrackIds,
    canRecord: canPressRecord(phase, armedTrackIds.size),
    dismissFailureNotice: () => setFailureNotice(null),
    failureNotice,
    isRecording: phase === "recording",
    isStartingRecording: phase === "starting",
    liveTakes,
    toggleRecording,
  };
}

function markEnded(
  takes: ReadonlyMap<string, LiveTake>,
  matches: (take: LiveTake) => boolean,
) {
  const next = new Map(takes);
  for (const [trackId, take] of takes) {
    if (!take.ended && matches(take)) {
      next.set(trackId, { ...take, ended: true });
    }
  }
  return next;
}

export type Recording = ReturnType<typeof useRecording>;
