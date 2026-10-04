import { type RefObject, useContext, useEffect, useRef, useState } from "react";
import {
  transientLevel,
  watchTransient,
} from "../../audio-mix/transient-monitor";
import { quartersToSeconds } from "../../composition-active-clips";
import type { EffectModulation } from "../../fx-modulation-defaults";
import {
  lfoTraceSeconds,
  sampleLfoTrace,
  scrollTrace,
  TRANSIENT_TRACE_SECONDS,
  transientTraceValue,
} from "../../fx-modulation-trace";
import type { FxDevice } from "../../fx-stack";
import { usePrefersReducedMotion } from "../MediaSyncSkeleton";
import { FxModulationClockContext } from "./modulation-clock";
import "./fx-modulation-graph.css";

// The graph's size in CSS pixels, matching fx-modulation-graph.css, and one
// sample per pixel.
const WIDTH = 56;
const HEIGHT = 16;
const SAMPLES = WIDTH;
// Room above and below the trace for the leading dot.
const PADDING = 2.5;

// Whether `ref`'s element is on screen: scrolled into the FX chain's view,
// in an expanded FX panel.
function useOnScreen(ref: RefObject<Element | null>) {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      setOnScreen(entries.at(-1)?.isIntersecting ?? false);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

// Draws `trace`, oldest first, as a heart monitor does: a line fading in
// from the left to a bright dot at its newest sample, over a faint
// midline.
function drawTrace(
  context: CanvasRenderingContext2D,
  trace: Float32Array,
  accent: string,
  scale: number,
) {
  const middle = HEIGHT / 2;
  const amplitude = middle - PADDING;
  const step = (WIDTH - PADDING) / (trace.length - 1);
  const y = (value: number) =>
    middle - Math.max(-1, Math.min(1, value)) * amplitude;

  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.clearRect(0, 0, WIDTH, HEIGHT);

  context.beginPath();
  for (let index = 0; index < trace.length; index++) {
    const x = index * step;
    if (index === 0) {
      context.moveTo(x, y(trace[index]));
    } else {
      context.lineTo(x, y(trace[index]));
    }
  }
  context.strokeStyle = accent;
  context.lineWidth = 1.25;
  context.lineJoin = "round";
  context.stroke();

  // The trail fades out toward its oldest end.
  const fade = context.createLinearGradient(0, 0, WIDTH, 0);
  fade.addColorStop(0, "rgba(0, 0, 0, 0)");
  fade.addColorStop(0.65, "rgba(0, 0, 0, 0.6)");
  fade.addColorStop(1, "rgba(0, 0, 0, 1)");
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = fade;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.globalCompositeOperation = "destination-over";
  context.globalAlpha = 0.2;
  context.fillStyle = accent;
  context.fillRect(0, middle - 0.5, WIDTH, 1);

  const headX = (trace.length - 1) * step;
  const headY = y(trace[trace.length - 1]);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.shadowColor = accent;
  context.shadowBlur = 4;
  context.fillStyle = accent;
  context.beginPath();
  context.arc(headX, headY, 1.75, 0, 2 * Math.PI);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "rgba(255, 255, 255, 0.85)";
  context.beginPath();
  context.arc(headX, headY, 0.8, 0, 2 * Math.PI);
  context.fill();
}

type FxModulationGraphProps = {
  device: FxDevice;
  modulation: EffectModulation;
};

// The small heart-monitor trace in the Modulation section's title: LFO's
// waveform at the playhead, scaled by Depth, or the hits Transient hears,
// scaled by Reactivity. It only moves while playback runs and it is on
// screen, and holds still for reduced motion. The knobs are the accessible
// controls, so screen readers skip it.
export function FxModulationGraph({
  device,
  modulation,
}: FxModulationGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useContext(FxModulationClockContext);
  const reducedMotion = usePrefersReducedMotion();
  const onScreen = useOnScreen(canvasRef);
  const { mode, lfo } = modulation;
  // Read each frame, so a new Motion doesn't restart the trace.
  const motionRef = useRef(modulation.transient.motion);
  motionRef.current = modulation.transient.motion;
  const { id, accent } = device;
  const animate = Boolean(clock?.isPlaying) && onScreen && !reducedMotion;

  useEffect(() => {
    if (mode === "transient" && onScreen) {
      return watchTransient(id);
    }
  }, [mode, onScreen, id]);

  const { shape, sync, rate, syncRate, phase, depth } = lfo;
  const seedKey = lfo.parameters[0] ?? "";
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(WIDTH * scale);
    canvas.height = Math.round(HEIGHT * scale);
    const trace = new Float32Array(SAMPLES);
    let frame = 0;
    const loop = (render: (now: number) => void) => {
      const tick = (now: number) => {
        render(now);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    };

    if (mode === "transient") {
      drawTrace(context, trace, accent, scale);
      if (!animate) {
        return;
      }
      const perSecond = SAMPLES / TRANSIENT_TRACE_SECONDS;
      let last: number | null = null;
      let steps = 0;
      return loop((now) => {
        steps += last === null ? 0 : ((now - last) / 1000) * perSecond;
        last = now;
        scrollTrace(
          trace,
          steps,
          transientTraceValue(motionRef.current, transientLevel(id)),
        );
        steps -= Math.floor(steps);
        drawTrace(context, trace, accent, scale);
      });
    }

    const settings = { shape, sync, rate, syncRate, phase, depth };
    const tempo = {
      bpm: clock?.bpm ?? 0,
      signature: clock?.signature,
    };
    const seconds = lfoTraceSeconds(settings, tempo);
    const seed = `${id} ${seedKey}`;
    const render = () => {
      const time = clock ? quartersToSeconds(clock.signal.get(), clock.bpm) : 0;
      sampleLfoTrace(
        settings,
        { ...tempo, time },
        seed,
        SAMPLES,
        seconds,
        trace,
      );
      drawTrace(context, trace, accent, scale);
    };
    render();
    if (animate) {
      return loop(render);
    }
    // Stopped, it follows the playhead as it is moved.
    if (clock && onScreen && !reducedMotion) {
      return clock.signal.subscribe(render);
    }
  }, [
    mode,
    animate,
    onScreen,
    reducedMotion,
    clock,
    id,
    accent,
    shape,
    sync,
    rate,
    syncRate,
    phase,
    depth,
    seedKey,
  ]);

  return (
    <span aria-hidden="true" className="fx-modulation-graph">
      <canvas ref={canvasRef} />
    </span>
  );
}
