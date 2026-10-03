import { useCallback, useEffect, useRef, useState } from "react";
import { VuMeter } from "../components/timeline/VuMeter";
import { Select, type SelectOption } from "../components/ui/select";
import {
  createMeterTap,
  type MasterMeterTap,
} from "../fx-shaders/audio-bands.ts";
import {
  describePreviewError,
  getMediaDevices,
  listRecordDevices,
  openPreviewStream,
  type PreviewStreamError,
  stopStream,
} from "./record-devices.ts";
import {
  BROWSER_DEFAULT_INPUT,
  type RecordDevice,
  type RecordInput,
  type RecordInputChoices,
  type RecordInputKind,
  resolveRecordInput,
} from "./record-inputs.ts";
import "./record-input-picker.css";

type RecordInputPickerProps = {
  // The choices to resolve, most specific first; the first is the one the
  // picker edits.
  choices: readonly RecordInputChoices[];
  // Undefined clears the choice, following the next level down.
  onChange: (kind: RecordInputKind, input: RecordInput | undefined) => void;
  // False stops the previews and releases the devices, as when the picker
  // is hidden.
  active: boolean;
  // Whether the user has asked for the inputs this page load, as by opening
  // the tab the picker is on. Until then, or until a device is picked,
  // nothing asks for camera or mic access.
  requested: boolean;
};

// Radix Select values can't be empty, so None and the default device have
// their own values; devices are prefixed so no device ID can collide.
const NONE_VALUE = "none";
const DEFAULT_VALUE = "default";
const DEVICE_PREFIX = "device:";

const KIND_LABELS: Record<RecordInputKind, string> = {
  video: "Video",
  audio: "Audio",
};

function toValue(input: RecordInput) {
  if (input === null) {
    return NONE_VALUE;
  }
  return input === BROWSER_DEFAULT_INPUT
    ? DEFAULT_VALUE
    : `${DEVICE_PREFIX}${input}`;
}

function fromValue(value: string): RecordInput | undefined {
  if (value === NONE_VALUE) {
    return null;
  }
  return value === DEFAULT_VALUE
    ? undefined
    : value.slice(DEVICE_PREFIX.length);
}

function getOptions(kind: RecordInputKind, devices: readonly RecordDevice[]) {
  const options: SelectOption<string>[] = [
    { value: NONE_VALUE, label: "None" },
    { value: DEFAULT_VALUE, label: "System default" },
  ];
  for (const device of devices) {
    if (device.kind !== kind) {
      continue;
    }
    // Before permission is granted devices have no IDs to pick them by.
    options.push(
      device.deviceId
        ? { value: `${DEVICE_PREFIX}${device.deviceId}`, label: device.label }
        : {
            value: `${DEVICE_PREFIX}?${options.length}`,
            label: device.label,
            disabled: true,
            reason: "Pick System default to allow access, then choose",
          },
    );
  }
  return options;
}

// Every attached camera and mic while `active`, refreshed as devices are
// plugged in or removed.
function useRecordDevices(active: boolean) {
  const [devices, setDevices] = useState<RecordDevice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const mediaDevices = getMediaDevices();
    if (!mediaDevices) {
      setLoaded(true);
      return;
    }
    try {
      setDevices(await listRecordDevices(mediaDevices));
    } catch {
      setDevices([]);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const mediaDevices = getMediaDevices();
    if (!active || !mediaDevices) {
      return;
    }
    void refresh();
    const onChange = () => void refresh();
    mediaDevices.addEventListener?.("devicechange", onChange);
    return () => mediaDevices.removeEventListener?.("devicechange", onChange);
  }, [active, refresh]);

  return { devices, loaded, refresh };
}

// The preview stream of `input` while `active`, stopped when it changes or
// the picker goes inactive.
function usePreviewStream(
  kind: RecordInputKind,
  input: RecordInput,
  active: boolean,
  onOpened: () => void,
  onError: (error: PreviewStreamError) => void,
) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const callbacksRef = useRef({ onOpened, onError });
  callbacksRef.current = { onOpened, onError };

  useEffect(() => {
    if (!active || input === null) {
      return;
    }
    let canceled = false;
    let opened: MediaStream | null = null;
    void openPreviewStream(getMediaDevices(), kind, input).then((result) => {
      if (canceled) {
        stopStream(result.stream);
        return;
      }
      if (result.error) {
        callbacksRef.current.onError(result.error);
        return;
      }
      opened = result.stream;
      setStream(opened);
      callbacksRef.current.onOpened();
    });
    return () => {
      canceled = true;
      stopStream(opened);
      setStream(null);
    };
  }, [active, input, kind]);

  return stream;
}

// A meter tap fed by the audio of `stream`, closed with it.
function useStreamMeterTap(stream: MediaStream | null) {
  const [tap, setTap] = useState<MasterMeterTap | null>(null);
  useEffect(() => {
    if (!stream) {
      return;
    }
    const context = new AudioContext();
    const meter = createMeterTap(context);
    context.createMediaStreamSource(stream).connect(meter.input);
    void context.resume().catch(() => {});
    setTap(meter.tap);
    return () => {
      setTap(null);
      void context.close().catch(() => {});
    };
  }, [stream]);
  return tap;
}

function VideoPreview({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);
  return (
    <div className="record-input-picker__video" data-live={!!stream}>
      {stream ? (
        <video
          aria-label="Camera preview"
          autoPlay
          muted
          playsInline
          ref={videoRef}
        />
      ) : (
        <span>No camera</span>
      )}
    </div>
  );
}

function AudioPreview({ stream }: { stream: MediaStream | null }) {
  const tap = useStreamMeterTap(stream);
  const getMeterTap = useCallback(() => tap, [tap]);
  return (
    <div className="record-input-picker__meter" data-live={!!tap}>
      <VuMeter getMeterTap={getMeterTap} isPlaying={!!tap} />
    </div>
  );
}

// A Video dropdown with a live camera preview under it and an Audio dropdown
// with a horizontal input meter under it, listing every attached camera and
// mic like the input list of a DAW. None turns that preview off. Nothing
// asks for camera or mic access until the picker is active, and the streams
// stop when it goes inactive or unmounts.
export function RecordInputPicker({
  choices,
  onChange,
  active,
  requested,
}: RecordInputPickerProps) {
  const [started, setStarted] = useState(requested);
  if (requested && !started) {
    setStarted(true);
  }
  const { devices, loaded, refresh } = useRecordDevices(active);
  const [errors, setErrors] = useState<
    Partial<Record<RecordInputKind, PreviewStreamError>>
  >({});
  const available = !!getMediaDevices();

  // Until the devices are listed, nothing is known to be missing.
  const resolve = (kind: RecordInputKind) =>
    loaded
      ? resolveRecordInput(kind, choices, devices)
      : (choices.find((choice) => choice[kind] !== undefined)?.[kind] ??
        BROWSER_DEFAULT_INPUT);
  const video = resolve("video");
  const audio = resolve("audio");

  const handleError = (kind: RecordInputKind, error: PreviewStreamError) => {
    setErrors((current) => ({ ...current, [kind]: error }));
    // Denied, the input stays None until the user picks again.
    if (error === "denied") {
      onChange(kind, null);
    }
  };
  // Labels and IDs appear once access is granted.
  const handleOpened = (kind: RecordInputKind) => {
    setErrors((current) => ({ ...current, [kind]: undefined }));
    void refresh();
  };

  const live = active && started && loaded && available;
  const videoStream = usePreviewStream(
    "video",
    video,
    live,
    () => handleOpened("video"),
    (error) => handleError("video", error),
  );
  const audioStream = usePreviewStream(
    "audio",
    audio,
    live,
    () => handleOpened("audio"),
    (error) => handleError("audio", error),
  );

  const renderField = (kind: RecordInputKind, input: RecordInput) => {
    const error = errors[kind];
    return (
      <div className="record-input-picker__field">
        <span className="record-input-picker__label">{KIND_LABELS[kind]}</span>
        <Select
          aria-label={`${KIND_LABELS[kind]} input`}
          disabled={!available}
          onValueChange={(value) => {
            setErrors((current) => ({ ...current, [kind]: undefined }));
            setStarted(true);
            onChange(kind, fromValue(value));
          }}
          options={getOptions(kind, devices)}
          value={toValue(input)}
        />
        {kind === "video" ? (
          <VideoPreview stream={videoStream} />
        ) : (
          <AudioPreview stream={audioStream} />
        )}
        {error ? (
          <p className="record-input-picker__error" role="alert">
            {describePreviewError(kind, error)}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="record-input-picker">
      {available ? null : (
        <p className="record-input-picker__error" role="alert">
          Cameras and microphones aren't available in this browser.
        </p>
      )}
      {renderField("video", video)}
      {renderField("audio", audio)}
      {available && !started ? (
        <button
          className="ghost-button ghost-button--accent record-input-picker__start"
          onClick={() => setStarted(true)}
          type="button"
        >
          Preview Inputs
        </button>
      ) : null}
    </div>
  );
}
