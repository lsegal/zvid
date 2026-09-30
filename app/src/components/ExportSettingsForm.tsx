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
import { Select } from "./ui/select";

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
          <Select
            aria-label="Resolution preset"
            disabled={disabled}
            onValueChange={(id) =>
              onChange((current) => ({
                ...current,
                ...applyCanvasPreset(current, id),
              }))
            }
            options={[
              ...CANVAS_PRESETS.map((preset) => ({
                value: preset.id,
                label: preset.label,
              })),
              { value: CUSTOM_PRESET_ID, label: "Custom", disabled: true },
            ]}
            value={presetId}
          />
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
        <Select
          aria-label="Frame rate"
          disabled={disabled}
          onValueChange={(value) => update({ fps: Number(value) })}
          options={[
            ...(frameRateLabel
              ? []
              : [
                  {
                    value: String(options.fps),
                    label: `${formatNumber(options.fps)} fps`,
                  },
                ]),
            ...FRAME_RATES.map((rate) => ({
              value: String(rate.value),
              label: `${rate.label} fps`,
            })),
          ]}
          value={String(
            FRAME_RATES.find((rate) => rate.label === frameRateLabel)?.value ??
              options.fps,
          )}
        />,
        errors.fps,
      )}

      {field(
        "videoCodec",
        "Video codec",
        <Select
          aria-label="Video codec"
          disabled={disabled}
          onValueChange={(videoCodec: VideoCodecChoice) =>
            setEncoding({ videoCodec })
          }
          options={videoCodecOptions(support).map((codec) => ({
            ...codec,
            label: codec.disabled
              ? `${codec.label} (unsupported)`
              : codec.label,
          }))}
          value={encoding.videoCodec}
        />,
        errors.codec,
      )}

      {field(
        "quality",
        "Quality",
        <div className="export-settings__row">
          <Select
            aria-label="Quality"
            disabled={disabled}
            onValueChange={(quality: VideoQuality) =>
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
              }))
            }
            options={VIDEO_QUALITIES}
            value={encoding.quality}
          />
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
          <Select
            aria-label="Audio bitrate"
            disabled={disabled}
            onValueChange={(value) =>
              setEncoding({
                audioBitrateKbps: Number(value) as AudioBitrateKbps,
              })
            }
            options={AUDIO_BITRATES.map((bitrate) => ({
              value: String(bitrate),
              label: `${bitrate} kbps`,
            }))}
            value={String(encoding.audioBitrateKbps)}
          />
        </div>,
      )}

      {field(
        "audioSampleRate",
        "Sample rate",
        <Select
          aria-label="Audio sample rate"
          disabled={disabled}
          onValueChange={(value) =>
            setEncoding({ audioSampleRate: Number(value) as AudioSampleRate })
          }
          options={AUDIO_SAMPLE_RATES.map((rate) => ({
            value: String(rate),
            label: `${formatNumber(rate / 1000)} kHz`,
          }))}
          value={String(encoding.audioSampleRate)}
        />,
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
