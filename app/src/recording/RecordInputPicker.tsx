import { useCallback, useEffect, useRef, useState } from "react";
import { VuMeter } from "../components/timeline/VuMeter";
import { Select, type SelectOption } from "../components/ui/select";
import { createMeterTap, type MasterMeterTap } from "../fx-shaders/audio-bands";
import type { RecordInput, RecordInputKind } from "./record-inputs.ts";
import "./record-input-picker.css";

export type RecordInputField = {
  value: string;
  options: readonly SelectOption<string>[];
  onChange: (value: string) => void;
  // The device to preview: an ID, undefined for the browser's default
  // device, or null for None, which turns the preview off.
  deviceId: RecordInput | undefined;
};

type RecordInputPickerProps = {
  video: RecordInputField;
  audio: RecordInputField;
  // Called once a preview stream is granted, when the browser starts
  // naming its devices.
  onStreamGranted?: () => void;
  // Called when the user or browser refuses access to a kind of device.
  onStreamDenied?: (kind: RecordInputKind) => void;
};

const KIND_LABELS: Record<RecordInputKind, string> = {
  video: "Video",
  audio: "Audio",
};

function isPermissionError(error: unknown) {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "NotAllowedError" || name === "SecurityError";
}

// Opens the chosen device for its preview, and stops it when the choice
// changes or the preview unmounts.
function useInputStream(
  kind: RecordInputKind,
  deviceId: RecordInput | undefined,
  onGranted: (() => void) | undefined,
  onDenied: ((kind: RecordInputKind) => void) | undefined,
) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;
  const onDeniedRef = useRef(onDenied);
  onDeniedRef.current = onDenied;

  useEffect(() => {
    setStream(null);
    setFailed(false);
    if (deviceId === null || !navigator.mediaDevices?.getUserMedia) {
      setFailed(deviceId !== null);
      return;
    }
    let canceled = false;
    let opened: MediaStream | null = null;
    const constraint =
      deviceId === undefined ? true : { deviceId: { exact: deviceId } };
    navigator.mediaDevices
      .getUserMedia(
        kind === "video" ? { video: constraint } : { audio: constraint },
      )
      .then(
        (granted) => {
          if (canceled) {
            for (const track of granted.getTracks()) {
              track.stop();
            }
            return;
          }
          opened = granted;
          setStream(granted);
          onGrantedRef.current?.();
        },
        (error: unknown) => {
          if (canceled) {
            return;
          }
          setFailed(true);
          if (isPermissionError(error)) {
            onDeniedRef.current?.(kind);
          }
        },
      );
    return () => {
      canceled = true;
      for (const track of opened?.getTracks() ?? []) {
        track.stop();
      }
    };
  }, [deviceId, kind]);

  return { stream, failed };
}

function VideoPreview({
  deviceId,
  onGranted,
  onDenied,
}: {
  deviceId: RecordInput | undefined;
  onGranted: (() => void) | undefined;
  onDenied: ((kind: RecordInputKind) => void) | undefined;
}) {
  const { stream, failed } = useInputStream(
    "video",
    deviceId,
    onGranted,
    onDenied,
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const message =
    deviceId === null
      ? "No video"
      : failed
        ? "Camera unavailable"
        : stream
          ? null
          : "Opening camera…";
  return (
    <div className="record-input-picker__video">
      <video
        aria-label="Camera preview"
        autoPlay
        muted
        playsInline
        ref={videoRef}
      />
      {message ? (
        <span className="record-input-picker__placeholder" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}

function AudioPreview({
  deviceId,
  onGranted,
  onDenied,
}: {
  deviceId: RecordInput | undefined;
  onGranted: (() => void) | undefined;
  onDenied: ((kind: RecordInputKind) => void) | undefined;
}) {
  const { stream, failed } = useInputStream(
    "audio",
    deviceId,
    onGranted,
    onDenied,
  );
  const tapRef = useRef<MasterMeterTap | null>(null);
  const [metering, setMetering] = useState(false);

  // The meter reads the microphone through analysers that output nowhere,
  // so the input is never played back.
  useEffect(() => {
    if (!stream) {
      return;
    }
    const context = new AudioContext();
    const { input, tap } = createMeterTap(context);
    context.createMediaStreamSource(stream).connect(input);
    void context.resume().catch(() => {});
    tapRef.current = tap;
    setMetering(true);
    return () => {
      tapRef.current = null;
      setMetering(false);
      void context.close().catch(() => {});
    };
  }, [stream]);

  const getMeterTap = useCallback(() => tapRef.current, []);
  const message =
    deviceId === null ? "No audio" : failed ? "Microphone unavailable" : null;
  return (
    <div className="record-input-picker__audio">
      <VuMeter getMeterTap={getMeterTap} isPlaying={metering} />
      {message ? (
        <span className="record-input-picker__placeholder" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}

// A Video dropdown with a live camera preview under it, and an Audio
// dropdown with a horizontal VU meter under it. Choosing None turns that
// preview off; the streams stop when the picker unmounts.
export function RecordInputPicker({
  video,
  audio,
  onStreamGranted,
  onStreamDenied,
}: RecordInputPickerProps) {
  const fields = { video, audio };
  return (
    <div className="record-input-picker">
      {(["video", "audio"] as const).map((kind) => (
        <div className="record-input-picker__field" key={kind}>
          <span className="record-input-picker__label">
            {KIND_LABELS[kind]}
          </span>
          <Select
            aria-label={`${KIND_LABELS[kind]} input`}
            className="record-input-picker__select"
            onValueChange={fields[kind].onChange}
            options={fields[kind].options}
            value={fields[kind].value}
          />
          {kind === "video" ? (
            <VideoPreview
              deviceId={video.deviceId}
              onDenied={onStreamDenied}
              onGranted={onStreamGranted}
            />
          ) : (
            <AudioPreview
              deviceId={audio.deviceId}
              onDenied={onStreamDenied}
              onGranted={onStreamGranted}
            />
          )}
        </div>
      ))}
    </div>
  );
}
