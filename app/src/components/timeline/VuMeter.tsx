import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import {
  type ChannelReading,
  dbToPosition,
  formatMeterDb,
  METER_MAX_DB,
  METER_MIN_DB,
  METER_TICKS_DB,
  StereoMeter,
  type StereoReading,
} from "../../app/vu-meter";
import type { MasterMeterTap } from "../../fx-shaders/audio-bands";
import "./vu-meter.css";

type VuMeterProps = {
  isPlaying: boolean;
  // The program mix to measure, or null when there is none yet. Asking
  // routes the main audio through Web Audio, so it is only asked for while
  // playing.
  getMeterTap: () => MasterMeterTap | null;
};

const CHANNELS = [
  { key: "left", label: "Left level" },
  { key: "right", label: "Right level" },
] as const;

// Screen readers hear the level at most this often.
const ARIA_INTERVAL_MS = 250;

// The gradient's colors sit at fixed levels, so a bar reveals it as it fills.
const SCALE_STYLE = {
  "--vu-yellow": `${dbToPosition(-12) * 100}%`,
  "--vu-orange": `${dbToPosition(-3) * 100}%`,
  "--vu-zero": `${dbToPosition(0) * 100}%`,
} as CSSProperties;

// Writes the readout's text, setting the ∞ of silence in its own span: the
// monospace font draws it too small to read.
function setReadout(element: HTMLElement, text: string) {
  if (element.dataset.text === text) {
    return;
  }
  element.dataset.text = text;
  const [before, after] = text.split("∞");
  if (after === undefined) {
    element.textContent = text;
    return;
  }
  const infinity = document.createElement("span");
  infinity.className = "vu-meter__infinity";
  infinity.textContent = "∞";
  element.replaceChildren(before, infinity, after);
}

function ariaLevel(db: number) {
  return String(Math.round(Math.min(METER_MAX_DB, Math.max(METER_MIN_DB, db))));
}

// A horizontal stereo VU meter of the program mix, before the preview
// volume: a bar per channel on a -60…+6 dB scale with a high-water line, a
// latching above-0 zone, and the RMS average in dB. It draws straight to
// the DOM each frame rather than re-rendering.
export function VuMeter({ isPlaying, getMeterTap }: VuMeterProps) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const meterRef = useRef(new StereoMeter());
  const tapRef = useRef<MasterMeterTap | null>(null);
  const lastAriaMsRef = useRef(-Infinity);

  const paint = useCallback((reading: StereoReading, nowMs: number) => {
    const channels: ChannelReading[] = [reading.left, reading.right];
    const announce = nowMs - lastAriaMsRef.current >= ARIA_INTERVAL_MS;
    if (announce) {
      lastAriaMsRef.current = nowMs;
    }
    channels.forEach((channel, index) => {
      const row = rowRefs.current[index];
      if (!row) {
        return;
      }
      row.style.setProperty(
        "--vu-level",
        String(dbToPosition(channel.levelDb)),
      );
      row.style.setProperty("--vu-peak", String(dbToPosition(channel.peakDb)));
      row.classList.toggle("has-peak", channel.peakDb > METER_MIN_DB);
      row.classList.toggle("is-clipped", channel.clipped);
      if (announce) {
        row.setAttribute("aria-valuenow", ariaLevel(channel.levelDb));
      }
    });
    if (readoutRef.current) {
      setReadout(readoutRef.current, formatMeterDb(reading.averageDb));
    }
  }, []);

  // The readout's text is never rendered by React, which would overwrite it.
  useLayoutEffect(() => {
    if (readoutRef.current) {
      setReadout(readoutRef.current, formatMeterDb(-Infinity));
    }
  }, []);

  useEffect(() => {
    const meter = meterRef.current;
    if (isPlaying) {
      meter.restart();
    }
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let buffers: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] | null =
      null;
    let frame = 0;

    const tick = (nowMs: number) => {
      // Stopped, the meter keeps reading the tap it has until it decays.
      const tap = isPlaying ? getMeterTap() : tapRef.current;
      if (tap !== tapRef.current || (tap && !buffers)) {
        tapRef.current = tap;
        buffers = tap
          ? [
              new Float32Array(tap.left.fftSize),
              new Float32Array(tap.right.fftSize),
            ]
          : null;
      }
      if (tap && buffers) {
        tap.left.getFloatTimeDomainData(buffers[0]);
        tap.right.getFloatTimeDomainData(buffers[1]);
      }
      const reading = meter.update(nowMs, buffers, reducedMotion);
      if (!isPlaying && meter.isIdle(nowMs)) {
        lastAriaMsRef.current = -Infinity;
        paint(reading, nowMs);
        frame = 0;
        return;
      }
      paint(reading, nowMs);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [getMeterTap, isPlaying, paint]);

  const clearClips = () => {
    const meter = meterRef.current;
    meter.clearClips();
    const nowMs = performance.now();
    paint(meter.reading(nowMs), nowMs);
  };

  return (
    <div className="vu-meter" style={SCALE_STYLE}>
      <div className="vu-meter__bars">
        {METER_TICKS_DB.map((db) => (
          <span
            aria-hidden="true"
            className="vu-meter__tick"
            key={db}
            style={{ left: `${dbToPosition(db) * 100}%` }}
          />
        ))}
        {CHANNELS.map(({ key, label }, index) => (
          // biome-ignore lint/a11y/useSemanticElements: a native <meter> can't draw the gradient, peak line and clip zone
          <div
            aria-label={label}
            aria-valuemax={METER_MAX_DB}
            aria-valuemin={METER_MIN_DB}
            aria-valuenow={METER_MIN_DB}
            className={`vu-meter__channel vu-meter__channel--${key}`}
            key={key}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            role="meter"
          >
            <span className="vu-meter__fill" />
            <span className="vu-meter__zone" />
            <span className="vu-meter__peak" />
          </div>
        ))}
        <button
          aria-label="Clear clip indicators"
          className="vu-meter__clip"
          onClick={clearClips}
          title="Above 0 dB. Click to clear."
          type="button"
        />
      </div>
      <span aria-live="off" className="vu-meter__readout" ref={readoutRef} />
    </div>
  );
}
