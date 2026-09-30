import type { ReactNode } from "react";
import type {
  ExportOptions,
  ExportOptionsErrors,
  ExportSettingField,
} from "../export-options.ts";
import {
  AUDIO_BITRATES,
  AUDIO_SAMPLE_RATES,
  type AudioBitrateKbps,
  type AudioSampleRate,
  applyCanvasPreset,
  CANVAS_PRESETS,
  CUSTOM_PRESET_ID,
  FRAME_RATES,
  matchCanvasPreset,
  matchFrameRate,
  type SessionEncoding,
  VIDEO_QUALITIES,
  type VideoCodecChoice,
  type VideoCodecSupport,
  type VideoQuality,
  videoBitrateMbps,
  videoCodecOptions,
} from "../session-settings.ts";

type ExportSettingsFormProps = {
  options: ExportOptions;
  modified: readonly ExportSettingField[];
  errors: ExportOptionsErrors;
  support: VideoCodecSupport;
  disabled: boolean;
  onChange(update: (options: ExportOptions) => ExportOptions): void;
  onReset(): void;
};

function formatNumber(value: number) {
  return String(Math.round(value * 100) / 100);
}

function numberValue(text: string) {
  return text.trim() === "" ? Number.NaN : Number(text);
}

// The output settings, pre-filled from Session Settings. A setting changed
// for this export shows a dot; Reset puts them all back.
export function ExportSettingsForm({
  options,
  modified,
  errors,
  support,
  disabled,
  onChange,
  onReset,
}: ExportSettingsFormProps) {
  const { encoding } = options;
  const presetId = matchCanvasPreset(options.canvasWidth, options.canvasHeight);
  const frameRateLabel = matchFrameRate(options.fps);

  function update(patch: Partial<ExportOptions>) {
    onChange((current) => ({ ...current, ...patch }));
  }

  function setEncoding(patch: Partial<SessionEncoding>) {
    onChange((current) => ({
      ...current,
      encoding: { ...current.encoding, ...patch },
    }));
  }

  function field(
    id: ExportSettingField | "fileName",
    label: string,
    control: ReactNode,
    error?: string,
  ) {
    const isModified = modified.includes(id as ExportSettingField);
    return (
      <div className="export-settings__field" data-export-field={id}>
        <span className="export-settings__label">
          {label}
          {isModified ? (
            <span
              aria-label="Changed from Session Settings"
              className="export-settings__modified"
              role="img"
              title="Changed from Session Settings"
            />
          ) : null}
        </span>
        {control}
        {error ? (
          <small className="export-settings__error" role="alert">
            {error}
          </small>
        ) : null}
      </div>
    );
  }

  return (
    <fieldset className="export-settings" disabled={disabled}>
      <legend className="export-settings__legend">
        Output
        {modified.length ? (
          <button
            className="export-settings__reset"
            onClick={onReset}
            type="button"
          >
            Reset to session settings
          </button>
        ) : null}
      </legend>

      {field(
        "resolution",
        "Resolution",
        <div className="export-settings__row">
          <select
            aria-label="Resolution preset"
            onChange={(event) => {
              const id = event.target.value;
              onChange((current) => ({
                ...current,
                ...applyCanvasPreset(current, id),
              }));
            }}
            value={presetId}
          >
            {CANVAS_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option disabled value={CUSTOM_PRESET_ID}>
              Custom
            </option>
          </select>
          <input
            aria-label="Width"
            className="export-settings__number"
            min={2}
            onChange={(event) =>
              update({ canvasWidth: numberValue(event.target.value) })
            }
            step={2}
            type="number"
            value={
              Number.isFinite(options.canvasWidth) ? options.canvasWidth : ""
            }
          />
          <span aria-hidden="true">×</span>
          <input
            aria-label="Height"
            className="export-settings__number"
            min={2}
            onChange={(event) =>
              update({ canvasHeight: numberValue(event.target.value) })
            }
            step={2}
            type="number"
            value={
              Number.isFinite(options.canvasHeight) ? options.canvasHeight : ""
            }
          />
        </div>,
        errors.canvasWidth ?? errors.canvasHeight,
      )}

      {field(
        "fps",
        "Frame rate",
        <select
          aria-label="Frame rate"
          onChange={(event) => update({ fps: Number(event.target.value) })}
          value={String(
            FRAME_RATES.find((rate) => rate.label === frameRateLabel)?.value ??
              options.fps,
          )}
        >
          {frameRateLabel ? null : (
            <option value={String(options.fps)}>
              {formatNumber(options.fps)} fps
            </option>
          )}
          {FRAME_RATES.map((rate) => (
            <option key={rate.label} value={String(rate.value)}>
              {rate.label} fps
            </option>
          ))}
        </select>,
        errors.fps,
      )}

      {field(
        "videoCodec",
        "Video codec",
        <select
          aria-label="Video codec"
          onChange={(event) =>
            setEncoding({ videoCodec: event.target.value as VideoCodecChoice })
          }
          value={encoding.videoCodec}
        >
          {videoCodecOptions(support).map((codec) => (
            <option
              disabled={codec.disabled}
              key={codec.value}
              title={codec.reason}
              value={codec.value}
            >
              {codec.disabled ? `${codec.label} (unsupported)` : codec.label}
            </option>
          ))}
        </select>,
        errors.codec,
      )}

      {field(
        "quality",
        "Quality",
        <div className="export-settings__row">
          <select
            aria-label="Quality"
            onChange={(event) => {
              const quality = event.target.value as VideoQuality;
              onChange((current) => ({
                ...current,
                encoding: {
                  ...current.encoding,
                  quality,
                  // Custom starts from the bitrate the preset gave.
                  ...(quality === "custom" &&
                  current.encoding.customBitrateMbps === undefined
                    ? { customBitrateMbps: videoBitrateMbps(current) }
                    : {}),
                },
              }));
            }}
            value={encoding.quality}
          >
            {VIDEO_QUALITIES.map((quality) => (
              <option key={quality.value} value={quality.value}>
                {quality.label}
              </option>
            ))}
          </select>
          {encoding.quality === "custom" ? (
            <input
              aria-label="Video bitrate (Mbps)"
              className="export-settings__number"
              min={0.5}
              onChange={(event) =>
                setEncoding({
                  customBitrateMbps: numberValue(event.target.value),
                })
              }
              step={0.5}
              type="number"
              value={
                Number.isFinite(encoding.customBitrateMbps)
                  ? encoding.customBitrateMbps
                  : ""
              }
            />
          ) : null}
          <span className="export-settings__hint">
            {formatNumber(videoBitrateMbps(options))} Mbps
          </span>
        </div>,
        errors.bitrate,
      )}

      {field(
        "audioBitrateKbps",
        "Audio",
        <div className="export-settings__row">
          <span className="export-settings__hint">AAC</span>
          <select
            aria-label="Audio bitrate"
            onChange={(event) =>
              setEncoding({
                audioBitrateKbps: Number(
                  event.target.value,
                ) as AudioBitrateKbps,
              })
            }
            value={encoding.audioBitrateKbps}
          >
            {AUDIO_BITRATES.map((bitrate) => (
              <option key={bitrate} value={bitrate}>
                {bitrate} kbps
              </option>
            ))}
          </select>
        </div>,
      )}

      {field(
        "audioSampleRate",
        "Sample rate",
        <select
          aria-label="Audio sample rate"
          onChange={(event) =>
            setEncoding({
              audioSampleRate: Number(event.target.value) as AudioSampleRate,
            })
          }
          value={encoding.audioSampleRate}
        >
          {AUDIO_SAMPLE_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {formatNumber(rate / 1000)} kHz
            </option>
          ))}
        </select>,
      )}

      {field(
        "fileName",
        "File name",
        <input
          aria-label="File name"
          className="export-settings__text"
          onChange={(event) => update({ fileName: event.target.value })}
          spellCheck={false}
          type="text"
          value={options.fileName}
        />,
        errors.fileName,
      )}
    </fieldset>
  );
}
