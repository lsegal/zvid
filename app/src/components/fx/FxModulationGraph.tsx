import { useCallback, useContext, useMemo, useRef } from "react";
import {
  transientLevel,
  watchTransient,
} from "../../audio-mix/transient-monitor";
import type { EffectModulation } from "../../fx-modulation-defaults";
import {
  lfoTraceSeconds,
  sampleLfoTrace,
  TRANSIENT_TRACE_SECONDS,
  transientTraceValue,
} from "../../fx-modulation-trace";
import type { FxDevice } from "../../fx-stack";
import { FxTraceGraph, TRACE_SAMPLES, type TraceSource } from "./FxTraceGraph";
import { FxModulationClockContext } from "./modulation-clock";

type FxModulationGraphProps = {
  device: FxDevice;
  modulation: EffectModulation;
};

// The trace in the Modulation section's title: LFO's waveform at the
// playhead, scaled by Depth, or the hits Transient hears, scaled by
// Reactivity.
export function FxModulationGraph({
  device,
  modulation,
}: FxModulationGraphProps) {
  const clock = useContext(FxModulationClockContext);
  const { mode, lfo } = modulation;
  // Read each frame, so a new Motion doesn't restart the trace.
  const motionRef = useRef(modulation.transient.motion);
  motionRef.current = modulation.transient.motion;
  const { id, accent } = device;

  const { shape, sync, rate, syncRate, phase, depth } = lfo;
  const seedKey = lfo.parameters[0] ?? "";
  const bpm = clock?.bpm ?? 0;
  const signature = clock?.signature;
  const sampleLfo = useCallback(
    (time: number, into: Float32Array) => {
      const settings = { shape, sync, rate, syncRate, phase, depth };
      const tempo = { bpm, signature };
      sampleLfoTrace(
        settings,
        { ...tempo, time },
        `${id} ${seedKey}`,
        TRACE_SAMPLES,
        lfoTraceSeconds(settings, tempo),
        into,
      );
    },
    [shape, sync, rate, syncRate, phase, depth, bpm, signature, id, seedKey],
  );
  const source = useMemo<TraceSource>(
    () =>
      mode === "transient"
        ? {
            kind: "scroll",
            perSecond: TRACE_SAMPLES / TRANSIENT_TRACE_SECONDS,
            level: () =>
              transientTraceValue(motionRef.current, transientLevel(id)),
            watch: () => watchTransient(id),
          }
        : { kind: "window", sample: sampleLfo },
    [mode, id, sampleLfo],
  );

  return (
    <FxTraceGraph
      accent={accent}
      className="fx-modulation-graph"
      source={source}
    />
  );
}
