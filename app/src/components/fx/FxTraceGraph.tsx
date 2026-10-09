import { type RefObject, useContext, useEffect, useRef, useState } from "react";
import { quartersToSeconds } from "../../composition-active-clips";
import { scrollTrace } from "../../fx-modulation-trace";
import { usePrefersReducedMotion } from "../MediaSyncSkeleton";
import { FxModulationClockContext } from "./modulation-clock";
import "./fx-trace-graph.css";

// The graph's size in CSS pixels, matching fx-trace-graph.css, and one
// sample per pixel.
const WIDTH = 56;
const HEIGHT = 16;
export const TRACE_SAMPLES = WIDTH;
// Room above and below the trace for the leading dot.
const PADDING = 2.5;

// Whether `ref`'s element is on screen: scrolled into the FX chain's view,
// in an expanded FX panel.
export function useOnScreen(ref: RefObject<Element | null>) {
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

// How a trace is found. A `window` trace is sampled afresh from the
// playhead time each frame, so it follows scrubs while stopped; `sample`
// fills `into` with the samples up to `time`. Give a new `sample` (from
// useCallback) when the settings change, to redraw. A `scroll` trace is
// only known as it plays: each frame scrolls in the `level` heard now,
// `perSecond` samples a second. Either may `watch` what it samples while
// the graph is on screen, until the returned function is called.
export type TraceSource = (
  | {
      kind: "window";
      sample: (time: number, into: Float32Array) => void;
    }
  | { kind: "scroll"; perSecond: number; level: () => number }
) & { watch?: () => () => void };

type FxTraceGraphProps = {
  accent: string;
  source: TraceSource;
  className?: string;
};

// A small heart-monitor trace for a section's title row, in the device's
// `accent`. It only moves while playback runs and it is on screen, and
// holds still for reduced motion. The knobs are the accessible controls, so
// screen readers skip it.
export function FxTraceGraph({ accent, source, className }: FxTraceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clock = useContext(FxModulationClockContext);
  const reducedMotion = usePrefersReducedMotion();
  const onScreen = useOnScreen(canvasRef);
  const animate = Boolean(clock?.isPlaying) && onScreen && !reducedMotion;
  // Read each frame, so new settings don't restart the trace.
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const kind = source.kind;
  const sample = source.kind === "window" ? source.sample : undefined;
  const watch = source.watch;
  useEffect(() => {
    if (onScreen && watch) {
      return watch();
    }
  }, [onScreen, watch]);
  // Redraws a stopped trace when the settings change.
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(WIDTH * scale);
    canvas.height = Math.round(HEIGHT * scale);
    const trace = new Float32Array(TRACE_SAMPLES);
    let frame = 0;
    const loop = (render: (now: number) => void) => {
      const tick = (now: number) => {
        render(now);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    };

    if (kind === "scroll") {
      redrawRef.current = null;
      drawTrace(context, trace, accent, scale);
      if (!animate) {
        return;
      }
      let last: number | null = null;
      let steps = 0;
      return loop((now) => {
        const current = sourceRef.current;
        if (current.kind !== "scroll") {
          return;
        }
        steps += last === null ? 0 : ((now - last) / 1000) * current.perSecond;
        last = now;
        scrollTrace(trace, steps, current.level());
        steps -= Math.floor(steps);
        drawTrace(context, trace, accent, scale);
      });
    }

    const render = () => {
      const current = sourceRef.current;
      if (current.kind !== "window") {
        return;
      }
      const time = clock ? quartersToSeconds(clock.signal.get(), clock.bpm) : 0;
      current.sample(time, trace);
      drawTrace(context, trace, accent, scale);
    };
    redrawRef.current = render;
    render();
    if (animate) {
      return loop(render);
    }
    // Stopped, it follows the playhead as it is moved.
    if (clock && onScreen && !reducedMotion) {
      return clock.signal.subscribe(render);
    }
  }, [kind, animate, onScreen, reducedMotion, clock, accent]);

  useEffect(() => {
    if (sample) {
      redrawRef.current?.();
    }
  }, [sample]);

  return (
    <span
      aria-hidden="true"
      className={className ? `fx-trace-graph ${className}` : "fx-trace-graph"}
    >
      <canvas ref={canvasRef} />
    </span>
  );
}
