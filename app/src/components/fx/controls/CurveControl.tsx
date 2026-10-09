import { ArrowPathIcon } from "@heroicons/react/24/solid";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CURVE_CHANNELS,
  type CurveChannel,
  type CurvePoint,
  evaluateCurve,
  formatCurves,
  IDENTITY_POINTS,
  isIdentityPoints,
  type LevelsCurves,
  MAX_CURVE_POINTS,
  MIN_POINT_GAP,
  parseCurves,
} from "../../../fx/effects/levels/curve.ts";
import {
  type CurveHistogram,
  curveHistogram,
  HISTOGRAM_BINS,
} from "../../../fx/effects/levels/histogram.ts";
import { previewFrameAnalysis } from "../../../fx-shaders/frame-analysis.ts";
import type { FxDevice } from "../../../fx-stack";
import { useOnScreen } from "../FxTraceGraph";
import type { FxParameterControlProps } from "../types";
import "./curve-control.css";

const WIDTH = 280;
const HEIGHT = 140;
// How near, in pixels, a press must be to a point to grab it.
const GRAB_RADIUS = 8;
// Samples drawn along the curve.
const CURVE_SAMPLES = 96;
// Keeps neighboring points this far apart on x, a little over the gap at
// which stored points merge.
const POINT_GAP = MIN_POINT_GAP + 0.002;
const KEY_STEP = 0.01;

const CHANNEL_LABELS: Record<CurveChannel, string> = {
  master: "Master",
  red: "R",
  green: "G",
  blue: "B",
};

const HISTOGRAM_CHANNEL: Record<CurveChannel, keyof CurveHistogram> = {
  master: "luma",
  red: "red",
  green: "green",
  blue: "blue",
};

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

// The latest histogram of the picture reaching `device`'s effect, read back
// by the preview while `plot` is on screen and the device is on.
function useCurveHistogram(
  device: FxDevice,
  plot: RefObject<SVGSVGElement | null>,
) {
  const [histogram, setHistogram] = useState<CurveHistogram | null>(null);
  const sampling = useOnScreen(plot) && device.enabled;
  useEffect(
    () =>
      sampling
        ? previewFrameAnalysis.subscribe(device.id, (sample) =>
            setHistogram(curveHistogram(sample)),
          )
        : undefined,
    [device.id, sampling],
  );
  return histogram;
}

// The histogram's bins as a filled area, tallest bin at the top, on a
// square-root scale so a few dominant levels don't flatten the rest.
function histogramPath(bins: Float32Array) {
  let peak = 0;
  for (const value of bins) {
    peak = Math.max(peak, Math.sqrt(value));
  }
  if (peak <= 0) {
    return "";
  }
  const width = WIDTH / HISTOGRAM_BINS;
  let path = `M0 ${HEIGHT}`;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
    const y = HEIGHT - (Math.sqrt(bins[bin]) / peak) * HEIGHT * 0.9;
    path += ` L${bin * width} ${y} L${(bin + 1) * width} ${y}`;
  }
  return `${path} L${WIDTH} ${HEIGHT} Z`;
}

function curvePath(points: readonly CurvePoint[]) {
  let path = "";
  for (let index = 0; index <= CURVE_SAMPLES; index++) {
    const x = index / CURVE_SAMPLES;
    const y = evaluateCurve(points, x);
    path += `${index ? " L" : "M"}${x * WIDTH} ${(1 - y) * HEIGHT}`;
  }
  return path;
}

// `point` moved to `[x, y]`, kept between its neighbors, with the first and
// last points held at their x.
function movePoint(
  points: readonly CurvePoint[],
  index: number,
  x: number,
  y: number,
): CurvePoint[] {
  const last = points.length - 1;
  const nextX =
    index === 0 || index === last
      ? points[index][0]
      : Math.max(
          points[index - 1][0] + POINT_GAP,
          Math.min(points[index + 1][0] - POINT_GAP, x),
        );
  return points.map((point, at) =>
    at === index ? [round(nextX), round(clampUnit(y))] : point,
  );
}

// Levels' tone curves: a tab for the master curve and each of red, green
// and blue, and a plot of the shown curve over a histogram of the picture
// reaching the effect. Pressing on the plot adds a point there, or grabs
// the point under it, and drags it; double-clicking or pressing Delete on a
// point removes it. Each drag is one undo step.
export function CurveControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const [channel, setChannel] = useState<CurveChannel>("master");
  const curves = parseCurves(parameter.stringValue);
  const points = curves[channel];
  const svg = useRef<SVGSVGElement | null>(null);
  const histogram = useCurveHistogram(device, svg);
  const drag = useRef<{ pointerId: number; index: number } | null>(null);
  // The points of a drag in progress, which the stored value catches up to.
  const [dragPoints, setDragPoints] = useState<CurvePoint[] | null>(null);
  const shownPoints = dragPoints ?? points;

  const store = (next: readonly CurvePoint[], mode: "commit" | "transient") => {
    const nextCurves: LevelsCurves = { ...curves, [channel]: next };
    onSetParameter(device, parameter.key, formatCurves(nextCurves), mode);
  };

  const plotPosition = (event: { clientX: number; clientY: number }) => {
    const bounds = svg.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) {
      return null;
    }
    return [
      clampUnit((event.clientX - bounds.left) / bounds.width),
      clampUnit(1 - (event.clientY - bounds.top) / bounds.height),
    ] as const;
  };

  const nearestPoint = (x: number, y: number) => {
    const bounds = svg.current?.getBoundingClientRect();
    const scaleX = bounds?.width ?? WIDTH;
    const scaleY = bounds?.height ?? HEIGHT;
    let best = -1;
    let bestDistance = GRAB_RADIUS;
    for (const [index, [px, py]] of points.entries()) {
      const distance = Math.hypot((px - x) * scaleX, (py - y) * scaleY);
      if (distance <= bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const position = plotPosition(event);
    if (event.button !== 0 || !position) {
      return;
    }
    event.preventDefault();
    const [x, y] = position;
    let index = nearestPoint(x, y);
    let next: CurvePoint[] = [...points];
    if (index < 0) {
      if (points.length >= MAX_CURVE_POINTS) {
        return;
      }
      index = points.findIndex(([px]) => px > x);
      if (
        index <= 0 ||
        x - points[index - 1][0] < POINT_GAP ||
        points[index][0] - x < POINT_GAP
      ) {
        return;
      }
      next.splice(index, 0, [round(x), round(y)]);
    } else {
      next = movePoint(points, index, x, y);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, index };
    setDragPoints(next);
    store(next, "transient");
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    const position = plotPosition(event);
    if (!state || !position || !dragPoints) {
      return;
    }
    if (state.pointerId !== event.pointerId) {
      return;
    }
    const next = movePoint(dragPoints, state.index, position[0], position[1]);
    setDragPoints(next);
    store(next, "transient");
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    drag.current = null;
    if (state?.pointerId === event.pointerId && dragPoints) {
      store(dragPoints, "commit");
    }
    setDragPoints(null);
  };

  const removePoint = (index: number) => {
    if (index <= 0 || index >= points.length - 1) {
      return;
    }
    store(
      points.filter((_, at) => at !== index),
      "commit",
    );
  };

  const onPointKeyDown = (
    event: ReactKeyboardEvent<SVGCircleElement>,
    index: number,
  ) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removePoint(index);
      return;
    }
    const step = event.shiftKey ? KEY_STEP / 10 : KEY_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    const [x, y] = points[index];
    store(movePoint(points, index, x + move[0], y + move[1]), "commit");
  };

  const bins = histogram?.[HISTOGRAM_CHANNEL[channel]];

  return (
    <div className={`fx-curve fx-curve--${channel}`} data-fx-no-drag>
      <div className="fx-curve__header">
        <span className="fx-curve__label">{parameter.label}</span>
        <div className="fx-curve__tabs">
          {CURVE_CHANNELS.map((option) => (
            <button
              aria-label={`${CHANNEL_LABELS[option]} curve`}
              aria-pressed={option === channel}
              className={`fx-curve__tab fx-curve__tab--${option}`}
              key={option}
              onClick={() => setChannel(option)}
              type="button"
            >
              {CHANNEL_LABELS[option]}
              {isIdentityPoints(curves[option]) ? null : (
                <span aria-hidden="true" className="fx-curve__edited" />
              )}
            </button>
          ))}
        </div>
        <button
          aria-label={`Reset ${CHANNEL_LABELS[channel]} curve`}
          className="fx-curve__reset"
          onClick={() => store(IDENTITY_POINTS, "commit")}
          title={`Reset ${CHANNEL_LABELS[channel]} curve`}
          type="button"
        >
          <ArrowPathIcon aria-hidden="true" />
        </button>
      </div>
      <svg
        aria-label={`${CHANNEL_LABELS[channel]} curve plot`}
        className="fx-curve__plot"
        data-fx-curve={channel}
        height={HEIGHT}
        onLostPointerCapture={() => {
          drag.current = null;
          setDragPoints(null);
        }}
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
      >
        <title>{`${CHANNEL_LABELS[channel]} curve`}</title>
        {[0.25, 0.5, 0.75].map((line) => (
          <g className="fx-curve__grid" key={line}>
            <line x1={line * WIDTH} x2={line * WIDTH} y1={0} y2={HEIGHT} />
            <line x1={0} x2={WIDTH} y1={line * HEIGHT} y2={line * HEIGHT} />
          </g>
        ))}
        {bins ? (
          <path
            className="fx-curve__histogram"
            d={histogramPath(bins)}
            data-fx-histogram
          />
        ) : null}
        <line
          className="fx-curve__diagonal"
          x1={0}
          x2={WIDTH}
          y1={HEIGHT}
          y2={0}
        />
        <path className="fx-curve__line" d={curvePath(shownPoints)} />
        {shownPoints.map(([x, y], index) => (
          <circle
            aria-label={`${CHANNEL_LABELS[channel]} curve point ${index + 1}`}
            aria-valuemax={1}
            aria-valuemin={0}
            aria-valuenow={y}
            aria-valuetext={`in ${x.toFixed(2)}, out ${y.toFixed(2)}`}
            className="fx-curve__point"
            cx={x * WIDTH}
            cy={(1 - y) * HEIGHT}
            data-curve-point={index}
            // biome-ignore lint/suspicious/noArrayIndexKey: points are identified by their order
            key={index}
            onDoubleClick={() => removePoint(index)}
            onKeyDown={(event) => onPointKeyDown(event, index)}
            r={4}
            role="slider"
            tabIndex={0}
          />
        ))}
      </svg>
    </div>
  );
}
