import { ArrowPathIcon } from "@heroicons/react/24/solid";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import {
  puckChannels,
  puckPosition,
} from "../../../fx/effects/levels/levels.ts";
import type { FxDeviceParameter } from "../../../fx-stack";
import type { FxParameterControlProps } from "../types";
import "./color-wheel-control.css";

// Pixels of puck drag across the wheel's radius, and of jog drag across the
// master's whole range.
const WHEEL_RADIUS = 44;
const JOG_PIXELS = 240;
const FINE_FACTOR = 10;
// A keyboard nudge of the puck, as a share of the radius.
const PUCK_STEP = 0.05;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function channelValue(parameter: FxDeviceParameter) {
  return (
    parameter.numericValue ??
    (typeof parameter.defaultValue === "number" ? parameter.defaultValue : 0)
  );
}

function defaultOf(parameter: FxDeviceParameter) {
  return typeof parameter.defaultValue === "number"
    ? parameter.defaultValue
    : 0;
}

// A typed value for one of the wheel's numbers, committed on Enter or blur
// and dropped on Escape.
function ChannelField({
  parameter,
  onCommit,
}: {
  parameter: FxDeviceParameter;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) {
      return;
    }
    const value = Number.parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(value)) {
      onCommit(clamp(value, parameter.min, parameter.max));
    }
  };
  const channel = parameter.wheel?.channel.toUpperCase() ?? "";
  return (
    <label className="fx-wheel__field">
      <span className={`fx-wheel__channel fx-wheel__channel--${channel}`}>
        {channel}
      </span>
      <input
        aria-label={parameter.label}
        data-fx-no-drag
        inputMode="decimal"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
          } else if (event.key === "Escape") {
            setDraft(null);
          }
        }}
        type="text"
        value={draft ?? parameter.display}
      />
    </label>
  );
}

// One of Levels' color wheels: a puck that tints the wheel's tonal range by
// moving its red, green and blue numbers apart, each of its Y, R, G and B
// numbers to type, a jog for the master Y, and a reset. A drag is one undo
// step however many numbers it moves.
export function ColorWheelControl({
  device,
  parameter,
  onSetParameter,
}: FxParameterControlProps) {
  const channels = parameter.channels ?? [parameter];
  const [master, red, green, blue] = channels;
  const reach = parameter.wheel?.reach ?? 1;
  const name = parameter.wheel?.name ?? parameter.label;
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    start: [number, number];
    mean: number;
    moved: boolean;
  } | null>(null);
  const jog = useRef<{
    pointerId: number;
    x: number;
    start: number;
    moved: boolean;
  } | null>(null);

  // Sets several of the wheel's numbers as one edit: every one but the last
  // as a transient update, so the last one's commit records them together.
  const setValues = (
    values: ReadonlyArray<readonly [FxDeviceParameter, number]>,
    mode: "commit" | "transient",
  ) => {
    for (const [index, [channel, value]] of values.entries()) {
      onSetParameter(
        device,
        channel.key,
        round(clamp(value, channel.min, channel.max)),
        index === values.length - 1 ? mode : "transient",
      );
    }
  };

  const colors = red && green && blue ? [red, green, blue] : [];
  const rgb = colors.map(channelValue) as [number, number, number];
  const [puckX, puckY] = colors.length ? puckPosition(rgb, reach) : [0, 0];
  const puckLength = Math.hypot(puckX, puckY);
  const shown = puckLength > 1 ? 1 / puckLength : 1;

  const moveColors = (
    position: [number, number],
    mean: number,
    mode: "commit" | "transient",
  ) => {
    if (!colors.length) {
      return;
    }
    const next = puckChannels(position, mean, reach);
    setValues(
      colors.map((channel, index) => [channel, next[index]] as const),
      mode,
    );
  };

  const meanOf = () => (rgb[0] + rgb[1] + rgb[2]) / 3;

  const onWheelPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !colors.length) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: [puckX, puckY],
      mean: meanOf(),
      moved: false,
    };
  };

  const dragPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) {
      return null;
    }
    const factor = event.shiftKey ? 1 / FINE_FACTOR : 1;
    return [
      state.start[0] + ((event.clientX - state.x) / WHEEL_RADIUS) * factor,
      state.start[1] + ((event.clientY - state.y) / WHEEL_RADIUS) * factor,
    ] as [number, number];
  };

  const onWheelPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const position = dragPosition(event);
    if (!state || !position || state.pointerId !== event.pointerId) {
      return;
    }
    state.moved = true;
    moveColors(position, state.mean, "transient");
  };

  const onWheelPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const position = dragPosition(event);
    drag.current = null;
    if (!state || !position || state.pointerId !== event.pointerId) {
      return;
    }
    if (state.moved) {
      moveColors(position, state.mean, "commit");
    }
  };

  const onWheelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? PUCK_STEP / FINE_FACTOR : PUCK_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    moveColors([puckX + move[0], puckY + move[1]], meanOf(), "commit");
  };

  // Centers the puck: the color numbers back to their defaults.
  const resetColors = () =>
    setValues(
      colors.map((channel) => [channel, defaultOf(channel)] as const),
      "commit",
    );

  const reset = () =>
    setValues(
      channels.map((channel) => [channel, defaultOf(channel)] as const),
      "commit",
    );

  const masterRange = master.max - master.min;
  const masterValue = channelValue(master);
  const masterPosition = masterRange
    ? (masterValue - master.min) / masterRange
    : 0;

  const onJogPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    jog.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      start: masterValue,
      moved: false,
    };
  };

  const jogValue = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = jog.current;
    if (!state) {
      return null;
    }
    const factor = event.shiftKey ? 1 / FINE_FACTOR : 1;
    return (
      state.start +
      ((event.clientX - state.x) / JOG_PIXELS) * masterRange * factor
    );
  };

  const onJogPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = jog.current;
    const value = jogValue(event);
    if (!state || value === null || state.pointerId !== event.pointerId) {
      return;
    }
    state.moved = true;
    setValues([[master, value]], "transient");
  };

  const onJogPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = jog.current;
    const value = jogValue(event);
    jog.current = null;
    if (state?.moved && value !== null && state.pointerId === event.pointerId) {
      setValues([[master, value]], "commit");
    }
  };

  const onJogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = (master.step ?? 0.01) * (event.shiftKey ? 1 : 5);
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? step
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -step
          : 0;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setValues(
        [[master, event.key === "Home" ? master.min : master.max]],
        "commit",
      );
    } else if (delta) {
      event.preventDefault();
      setValues([[master, masterValue + delta]], "commit");
    }
  };

  const tint = colors.length
    ? `rgb(${rgb
        .map((value) =>
          Math.round(clamp(128 + ((value - meanOf()) / reach) * 127, 0, 255)),
        )
        .join(", ")})`
    : "transparent";

  return (
    <fieldset className="fx-wheel" data-fx-wheel={name} data-fx-no-drag>
      <legend className="fx-wheel__header">
        <span className="fx-wheel__label">{name}</span>
        <button
          aria-label={`Reset ${name}`}
          className="fx-wheel__reset"
          onClick={reset}
          title={`Reset ${name}`}
          type="button"
        >
          <ArrowPathIcon aria-hidden="true" />
        </button>
      </legend>
      <div
        aria-label={`${name} color`}
        aria-roledescription="color wheel"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(Math.min(1, puckLength) * 100)}
        aria-valuetext={`R ${red?.display ?? ""}, G ${green?.display ?? ""}, B ${blue?.display ?? ""}`}
        className="fx-wheel__disc"
        onDoubleClick={resetColors}
        onKeyDown={onWheelKeyDown}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerDown={onWheelPointerDown}
        onPointerMove={onWheelPointerMove}
        onPointerUp={onWheelPointerUp}
        role="slider"
        tabIndex={0}
        title={`Drag to tint ${name}; double-click to center`}
      >
        <span
          className="fx-wheel__puck"
          style={{
            left: `${50 + puckX * shown * 50}%`,
            top: `${50 + puckY * shown * 50}%`,
            background: tint,
          }}
        />
      </div>
      <div className="fx-wheel__fields">
        {channels.map((channel) => (
          <ChannelField
            key={channel.key}
            onCommit={(value) => setValues([[channel, value]], "commit")}
            parameter={channel}
          />
        ))}
      </div>
      <div
        aria-label={`${name} master`}
        aria-valuemax={master.max}
        aria-valuemin={master.min}
        aria-valuenow={masterValue}
        aria-valuetext={master.display}
        className="fx-wheel__jog"
        onDoubleClick={() => setValues([[master, defaultOf(master)]], "commit")}
        onKeyDown={onJogKeyDown}
        onLostPointerCapture={() => {
          jog.current = null;
        }}
        onPointerDown={onJogPointerDown}
        onPointerMove={onJogPointerMove}
        onPointerUp={onJogPointerUp}
        role="slider"
        tabIndex={0}
        title={`Drag to adjust ${name}; double-click to reset`}
      >
        <span
          className="fx-wheel__jog-mark"
          style={{ left: `${masterPosition * 100}%` }}
        />
      </div>
    </fieldset>
  );
}
