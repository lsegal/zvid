import {
  ArrowsRightLeftIcon,
  LockClosedIcon,
  LockOpenIcon,
} from "@heroicons/react/24/solid";
import { type ReactNode, useEffect, useId, useState } from "react";
import { probeVideoCodecSupport } from "../harness/export";
import {
  AUDIO_BITRATES,
  AUDIO_SAMPLE_RATES,
  type AudioBitrateKbps,
  type AudioSampleRate,
  applyCanvasPreset,
  CANVAS_PRESETS,
  CUSTOM_PRESET_ID,
  FRAME_RATES,
  hasSessionSettingsErrors,
  matchCanvasPreset,
  matchFrameRate,
  presetBitrateMbps,
  resizeCanvas,
  resolveAutoCodec,
  type SessionEncoding,
  type SessionSettings,
  swapCanvasOrientation,
  VIDEO_CODECS,
  VIDEO_QUALITIES,
  type VideoCodecChoice,
  type VideoCodecSupport,
  validateSessionSettings,
  videoBitrateMbps,
  videoCodecOptions,
} from "../session-settings";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Select } from "./ui/select";
import "./session-settings-dialog.css";

type SessionSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The session's current settings, which the dialog starts from.
  settings: SessionSettings;
  onApply: (settings: SessionSettings) => void;
};

const CUSTOM_FRAME_RATE = "custom";

function codecLabel(codec: VideoCodecChoice) {
  return VIDEO_CODECS.find((option) => option.value === codec)?.label ?? codec;
}

/**
 * File ▸ Session Settings: the session's canvas size, frame rate and export
 * encoding. It also owns the Ctrl/Cmd+, shortcut that opens it.
 */
export function SessionSettingsDialog({
  open,
  onOpenChange,
  settings,
  onApply,
}: SessionSettingsDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "," &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="session-settings-dialog">
        {open ? (
          <SessionSettingsForm
            initial={settings}
            onApply={(next) => {
              onApply(next);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="session-settings__field">
      <span className="share-dialog__label">{label}</span>
      {children}
      {error ? (
        <span className="session-settings__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function numberOrNaN(value: string) {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function inputValue(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? value : "";
}

function SessionSettingsForm({
  initial,
  onApply,
}: {
  initial: SessionSettings;
  onApply: (settings: SessionSettings) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [lockAspect, setLockAspect] = useState(true);
  const [customFps, setCustomFps] = useState(
    () => matchFrameRate(initial.fps) === undefined,
  );
  const [support, setSupport] = useState<VideoCodecSupport>({});
  const { canvasWidth, canvasHeight, fps, encoding } = draft;

  const errors = validateSessionSettings(draft, support);
  const bitrateMbps = videoBitrateMbps(draft);

  // Encoders can refuse a size or bitrate, so ask again when either changes.
  const probeBitrate = Number.isFinite(bitrateMbps) ? bitrateMbps : 0;
  const canProbe =
    !errors.canvasWidth && !errors.canvasHeight && probeBitrate > 0;
  useEffect(() => {
    if (!canProbe) {
      return;
    }
    let canceled = false;
    probeVideoCodecSupport(canvasWidth, canvasHeight, probeBitrate * 1e6)
      .then((result) => {
        if (!canceled) {
          setSupport(result);
        }
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [canProbe, canvasWidth, canvasHeight, probeBitrate]);

  const setEncoding = (patch: Partial<SessionEncoding>) =>
    setDraft((current) => ({
      ...current,
      encoding: { ...current.encoding, ...patch },
    }));

  const autoCodec = resolveAutoCodec(support);
  const invalid = hasSessionSettingsErrors(errors);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) {
          onApply(draft);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Session Settings</DialogTitle>
        <DialogDescription>
          The canvas, frame rate and encoding this session previews and exports
          at.
        </DialogDescription>
      </DialogHeader>

      <div className="session-settings__body">
        <div className="session-settings__pair">
          <fieldset className="session-settings__group">
            <legend>Canvas</legend>
            <Field label="Preset">
              <Select
                aria-label="Canvas preset"
                className="session-settings__input"
                onValueChange={(value) =>
                  setDraft((current) => applyCanvasPreset(current, value))
                }
                options={[
                  ...CANVAS_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: preset.label,
                  })),
                  { value: CUSTOM_PRESET_ID, label: "Custom" },
                ]}
                value={matchCanvasPreset(canvasWidth, canvasHeight)}
              />
            </Field>
            <div className="session-settings__size">
              <Field label="Width" error={errors.canvasWidth}>
                <input
                  aria-invalid={!!errors.canvasWidth}
                  aria-label="Canvas width"
                  className="session-settings__input"
                  min={16}
                  onChange={(event) =>
                    setDraft((current) =>
                      resizeCanvas(
                        current,
                        "width",
                        numberOrNaN(event.target.value),
                        lockAspect,
                      ),
                    )
                  }
                  step={2}
                  type="number"
                  value={inputValue(canvasWidth)}
                />
              </Field>
              <button
                aria-label={
                  lockAspect ? "Unlock aspect ratio" : "Lock aspect ratio"
                }
                aria-pressed={lockAspect}
                className={`session-settings__icon-button${
                  lockAspect ? " is-active" : ""
                }`}
                onClick={() => setLockAspect((locked) => !locked)}
                title="Lock aspect ratio"
                type="button"
              >
                {lockAspect ? (
                  <LockClosedIcon aria-hidden="true" />
                ) : (
                  <LockOpenIcon aria-hidden="true" />
                )}
              </button>
              <Field label="Height" error={errors.canvasHeight}>
                <input
                  aria-invalid={!!errors.canvasHeight}
                  aria-label="Canvas height"
                  className="session-settings__input"
                  min={16}
                  onChange={(event) =>
                    setDraft((current) =>
                      resizeCanvas(
                        current,
                        "height",
                        numberOrNaN(event.target.value),
                        lockAspect,
                      ),
                    )
                  }
                  step={2}
                  type="number"
                  value={inputValue(canvasHeight)}
                />
              </Field>
              <button
                aria-label="Swap width and height"
                className="session-settings__icon-button"
                onClick={() => setDraft(swapCanvasOrientation)}
                title="Swap width and height"
                type="button"
              >
                <ArrowsRightLeftIcon aria-hidden="true" />
              </button>
            </div>
          </fieldset>

          <fieldset className="session-settings__group">
            <legend>Timing</legend>
            <div className="session-settings__stack">
              <Field
                label="Frame rate"
                error={customFps ? undefined : errors.fps}
              >
                <Select
                  aria-label="Frame rate"
                  className="session-settings__input"
                  onValueChange={(value) => {
                    if (value === CUSTOM_FRAME_RATE) {
                      setCustomFps(true);
                      return;
                    }
                    setCustomFps(false);
                    setDraft((current) => ({ ...current, fps: Number(value) }));
                  }}
                  value={
                    customFps
                      ? CUSTOM_FRAME_RATE
                      : String(
                          FRAME_RATES.find(
                            (rate) => rate.label === matchFrameRate(fps),
                          )?.value ?? CUSTOM_FRAME_RATE,
                        )
                  }
                  options={[
                    ...FRAME_RATES.map((rate) => ({
                      value: String(rate.value),
                      label: `${rate.label} fps`,
                    })),
                    { value: CUSTOM_FRAME_RATE, label: "Custom…" },
                  ]}
                />
              </Field>
              {customFps ? (
                <Field label="Custom fps" error={errors.fps}>
                  <input
                    aria-invalid={!!errors.fps}
                    aria-label="Custom frame rate"
                    className="session-settings__input"
                    min={0}
                    onChange={(event) => {
                      const next = numberOrNaN(event.target.value);
                      setDraft((current) => ({ ...current, fps: next }));
                    }}
                    step="any"
                    type="number"
                    value={inputValue(fps)}
                  />
                </Field>
              ) : null}
            </div>
          </fieldset>
        </div>

        <fieldset className="session-settings__group">
          <legend>Video encoding</legend>
          <div className="session-settings__row">
            <Field label="Codec" error={errors.codec}>
              <Select
                aria-describedby={`${id}-codec`}
                aria-label="Video codec"
                className="session-settings__input"
                onValueChange={(videoCodec: VideoCodecChoice) =>
                  setEncoding({ videoCodec })
                }
                options={videoCodecOptions(support).map((option) => ({
                  ...option,
                  label: option.reason
                    ? `${option.label} (${option.reason})`
                    : option.label,
                }))}
                value={encoding.videoCodec}
              />
              {encoding.videoCodec === "auto" ? (
                <span className="session-settings__hint" id={`${id}-codec`}>
                  {autoCodec
                    ? `Uses ${codecLabel(autoCodec)} on this device.`
                    : "Uses HEVC, then AV1, then H.264, as supported."}
                </span>
              ) : null}
            </Field>
            <Field label="Container">
              <span className="session-settings__static">MP4</span>
            </Field>
          </div>
          <div className="session-settings__row">
            <Field label="Quality">
              <div className="segmented-control session-settings__segmented">
                {VIDEO_QUALITIES.map((quality) => (
                  <button
                    aria-pressed={encoding.quality === quality.value}
                    className={
                      encoding.quality === quality.value ? "is-active" : ""
                    }
                    key={quality.value}
                    onClick={() =>
                      setEncoding(
                        quality.value === "custom"
                          ? {
                              quality: "custom",
                              customBitrateMbps:
                                encoding.customBitrateMbps ?? bitrateMbps,
                            }
                          : { quality: quality.value },
                      )
                    }
                    type="button"
                  >
                    {quality.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Bitrate (Mbps)" error={errors.bitrate}>
              {encoding.quality === "custom" ? (
                <input
                  aria-invalid={!!errors.bitrate}
                  aria-label="Video bitrate in Mbps"
                  className="session-settings__input"
                  min={0}
                  onChange={(event) =>
                    setEncoding({
                      customBitrateMbps: numberOrNaN(event.target.value),
                    })
                  }
                  step="any"
                  type="number"
                  value={inputValue(encoding.customBitrateMbps)}
                />
              ) : (
                <span className="session-settings__static">
                  {Number.isFinite(canvasWidth) &&
                  Number.isFinite(canvasHeight) &&
                  Number.isFinite(fps)
                    ? `≈ ${presetBitrateMbps(
                        canvasWidth,
                        canvasHeight,
                        fps,
                        encoding.quality,
                      )} Mbps`
                    : "—"}
                </span>
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="session-settings__group">
          <legend>Audio</legend>
          <div className="session-settings__row">
            <Field label="Codec">
              <span className="session-settings__static">AAC</span>
            </Field>
            <Field label="Bitrate">
              <Select
                aria-label="Audio bitrate"
                className="session-settings__input"
                onValueChange={(value) =>
                  setEncoding({
                    audioBitrateKbps: Number(value) as AudioBitrateKbps,
                  })
                }
                options={AUDIO_BITRATES.map((kbps) => ({
                  value: String(kbps),
                  label: `${kbps} kbps`,
                }))}
                value={String(encoding.audioBitrateKbps)}
              />
            </Field>
            <Field label="Sample rate">
              <Select
                aria-label="Audio sample rate"
                className="session-settings__input"
                onValueChange={(value) =>
                  setEncoding({
                    audioSampleRate: Number(value) as AudioSampleRate,
                  })
                }
                options={AUDIO_SAMPLE_RATES.map((rate) => ({
                  value: String(rate),
                  label: `${rate / 1000} kHz`,
                }))}
                value={String(encoding.audioSampleRate)}
              />
            </Field>
          </div>
        </fieldset>
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <button className="ghost-button" type="button">
            Cancel
          </button>
        </DialogClose>
        <button
          className="ghost-button ghost-button--accent"
          disabled={invalid}
          type="submit"
        >
          Apply
        </button>
      </DialogFooter>
    </form>
  );
}
