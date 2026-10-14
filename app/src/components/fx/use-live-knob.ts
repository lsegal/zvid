import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  transientHit,
  transientLevel,
  watchTransient,
} from "../../audio-mix/transient-monitor";
import { quartersToSeconds } from "../../composition-clip-timing";
import { reactiveOnsets, watchReactiveOnsets } from "../../fx-animation-onsets";
import { findAnimationClipSpan } from "../../fx-animation-trace";
import {
  drivesKnob,
  type LiveDevice,
  type LiveTime,
  liveDriver,
  liveKnobValue,
} from "../../fx-live-values";
import type { FxDevice } from "../../fx-stack";
import {
  FxAnimationTimelineContext,
  FxModulationClockContext,
} from "./modulation-clock";

// Where the device's Animation or Modulation has moved the knob `key` to,
// following the playhead as it plays and as it is moved, or undefined while
// nothing moves it. Only the knob re-renders as it moves, not the FX chain.
export function useLiveKnob(device: FxDevice, key: string) {
  const clock = useContext(FxModulationClockContext);
  const timeline = useContext(FxAnimationTimelineContext);
  const driver = useMemo(() => liveDriver(device), [device]);
  const driven = drivesKnob(driver, key);
  // Transient follows the level its stage reports; Reactive the hits the
  // preview has heard.
  const listen =
    driver?.kind === "reactive"
      ? "reactive"
      : driver?.kind === "modulation" && driver.modulation.mode === "transient"
        ? "transient"
        : undefined;
  const [live, setLive] = useState<number | undefined>(undefined);
  // Read each frame, so a new setting or a drag doesn't restart the loop.
  const current = useRef({ device, driver });
  current.current = { device, driver };
  const readRef = useRef<(() => void) | null>(null);

  const { id, group } = device;
  useEffect(() => {
    if (!driven || !clock) {
      readRef.current = null;
      setLive(undefined);
      return;
    }
    const stopListening =
      listen === "reactive"
        ? watchReactiveOnsets()
        : listen === "transient"
          ? watchTransient(id)
          : undefined;
    const read = () => {
      const time = quartersToSeconds(clock.signal.get(), clock.bpm);
      const fps = timeline?.fps ?? 0;
      const at: LiveTime = {
        time,
        bpm: clock.bpm,
        signature: clock.signature,
        fps,
      };
      const { device: latest, driver: latestDriver } = current.current;
      if (latestDriver?.kind === "clip" && timeline) {
        at.clipSpan = findAnimationClipSpan(
          timeline.clips,
          { group, laneId: timeline.laneId, clipId: timeline.clipId },
          time,
          clock.bpm,
          fps,
          timeline.lanePriority,
          timeline.sessionEndSeconds,
        );
      } else if (listen === "reactive") {
        at.onsets = reactiveOnsets();
      } else if (listen === "transient") {
        at.transient = { level: transientLevel(id), hit: transientHit(id) };
      }
      setLive(liveKnobValue(latest as LiveDevice, latestDriver, key, at));
    };
    readRef.current = read;
    read();
    let stop: () => void;
    if (clock.isPlaying) {
      let frame = requestAnimationFrame(function tick() {
        read();
        frame = requestAnimationFrame(tick);
      });
      stop = () => cancelAnimationFrame(frame);
    } else {
      // Stopped, it follows the playhead as it is moved.
      stop = clock.signal.subscribe(read);
    }
    return () => {
      stop();
      stopListening?.();
      readRef.current = null;
    };
  }, [driven, clock, timeline, listen, id, group, key]);

  // A new setting or set value moves the knob at once, even when stopped.
  // (`driver` is worked out afresh from each new device.)
  useEffect(() => {
    if (driver) {
      readRef.current?.();
    }
  }, [driver]);

  return live;
}
