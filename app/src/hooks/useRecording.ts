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
import { getHarness } from "../harness";
import { type MediaItem, toShareableMediaItem } from "../media";
import { LiveTakeMonitor } from "../recording/live-take-monitor.ts";
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
  type PlacedTake,
  recordedTakeFileName,
  remuxRecording,
  withRecordedDuration,
} from "../recording/recorded-takes.ts";
import {
  type FinishedTake,
  getBrowserRecordingDeps,
  type RecordingDeps,
  RecordingSession,
  recordingExtension,
} from "../recording/recording-session.ts";

// How often the growing clips redraw, in milliseconds.
const LIVE_TICK_MS = 200;

// A track's clip while it records: where it starts, how long it is so far,
// and what it has captured.
export type LiveTake = {
  trackId: string;
  startQ: number;
  durationSeconds: number;
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
  setRecordingEndQ: (endQ: number) => void;
  // Stands in for the browser's MediaRecorder and mediaDevices in tests.
  deps?: RecordingDeps | null;
};

type ActivePass = {
  session: RecordingSession;
  startQ: number;
  startedAt: Date;
  monitors: LiveTakeMonitor[];
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
  deps,
}: RecordingInputs) {
  const armedTrackIds = useArmedTrackIds();
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [liveTakes, setLiveTakes] = useState<ReadonlyMap<string, LiveTake>>(
    () => new Map(),
  );
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
      if (!finished.length) {
        setStatus("Recording stopped before anything was captured.");
        return;
      }
      setStatus(`Saving ${pluralize(finished.length, "recording")}...`);
      try {
        const files = await Promise.all(
          finished.map(async (take) => {
            const blob = await remuxRecording(take.blob);
            return new File(
              [blob],
              recordedTakeFileName(
                trackName(take.trackId),
                pass.startedAt,
                recordingExtension(take.mimeType),
              ),
              { type: take.mimeType, lastModified: Date.now() },
            );
          }),
        );
        const analyzed = await getHarness().analyzeMedia(
          { kind: "files", files },
          PALETTE,
          mediaItemCount,
        );
        const items = analyzed.map((item, index) =>
          withRecordedDuration(item, finished[index]?.durationSeconds ?? 0),
        );
        const placed: PlacedTake[] = items.flatMap((item, index) => {
          const take = finished[index];
          return take
            ? [
                {
                  trackId: take.trackId,
                  item: toShareableMediaItem(item),
                  startQ: pass.startQ,
                },
              ]
            : [];
        });
        commitProjectChange("Record", (current) =>
          addRecordedTakes(current, placed),
        );
        seedLocalMediaItems(items);
        void cacheLocalMediaItems(items);
        setSourceTracksCollapsed(false);
        setStatus(`Recorded ${pluralize(items.length, "clip")}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Saving the recording failed: ${message}`);
      }
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
    setLiveTakes((current) => markEnded(current, () => true));
    try {
      await saveTakes(pass, await pass.session.stop());
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
        ? getBrowserRecordingDeps((trackId, devices) =>
            resolveTrackInputs(trackId, devices),
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
    const takes = session.getTakes().map<LiveTake>((take) => ({
      trackId: take.trackId,
      startQ,
      durationSeconds: 0,
      hasVideo: take.hasVideo,
      hasAudio: take.hasAudio,
      monitor: new LiveTakeMonitor(take.stream, () => session.elapsedSeconds()),
      ended: false,
    }));
    passRef.current = {
      session,
      startQ,
      startedAt: new Date(),
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

  // Clips grow while their tracks record.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      const pass = passRef.current;
      if (!pass) return;
      const elapsed = pass.session.elapsedSeconds();
      setRecordingEndQ(pass.startQ + secondsToQuarters(elapsed, bpm));
      setLiveTakes((current) => {
        const next = new Map(current);
        for (const [trackId, take] of current) {
          if (!take.ended) {
            next.set(trackId, { ...take, durationSeconds: elapsed });
          }
        }
        return next;
      });
    }, LIVE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [bpm, phase, setRecordingEndQ]);

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
