import { ChevronLeftIcon } from "@heroicons/react/24/solid";
import { useState, useSyncExternalStore } from "react";
import {
  type RecordInputField,
  RecordInputPicker,
} from "../recording/RecordInputPicker";
import { toggleTrackArmed, useTrackArmed } from "../recording/record-arm.ts";
import {
  type AvailableInputs,
  browserDefaultLabel,
  getRecordInputsVersion,
  listInputDevices,
  RECORD_INPUT_KINDS,
  type RecordInputKind,
  resolveDefaultInput,
  resolveTrackInputs,
  resolveTrackOverride,
  subscribeRecordInputs,
  writeTrackInputOverride,
} from "../recording/record-inputs.ts";
import {
  buildTrackInputOptions,
  describeDefaultInput,
  foldOnArmChange,
  initialRecordDeviceFold,
  parseTrackInputValue,
  toggleRecordDeviceFold,
  trackInputValue,
} from "../recording/track-record-device.ts";
import { useMediaInputDevices } from "../recording/use-media-input-devices.ts";
import "./fx/fx-chain.css";
import "./track-record-device.css";

type TrackRecordDeviceProps = {
  trackId: string;
  trackName: string | undefined;
};

function ArmButton({
  armed,
  compact,
  onToggle,
  trackName,
}: {
  armed: boolean;
  compact?: boolean;
  onToggle: () => void;
  trackName: string;
}) {
  const label = armed
    ? `Disarm ${trackName}`
    : `Arm ${trackName} for recording`;
  return (
    <button
      aria-label={label}
      aria-pressed={armed}
      className={`track-record-device__arm${compact ? " track-record-device__arm--compact" : ""}`}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}

// The track's Video and Audio dropdowns. Each starts out on "Default (…)",
// the default input, and choosing a device or None overrides it for this
// track. Mounted only while the device is expanded, so its previews stop
// when it folds.
function TrackRecordInputs({ trackId }: { trackId: string }) {
  const { infos, ready, refresh } = useMediaInputDevices();
  // Re-reads the saved choices whenever any of them changes.
  useSyncExternalStore(subscribeRecordInputs, getRecordInputsVersion);
  const devices = {
    video: listInputDevices(infos, "video"),
    audio: listInputDevices(infos, "audio"),
  };
  const available: AvailableInputs | undefined = ready
    ? {
        video: devices.video.map((device) => device.deviceId),
        audio: devices.audio.map((device) => device.deviceId),
      }
    : undefined;
  const resolved = resolveTrackInputs(trackId, available);

  function field(kind: RecordInputKind): RecordInputField {
    const defaultLabel = describeDefaultInput(
      resolveDefaultInput(kind, available),
      devices[kind],
      browserDefaultLabel(infos, kind),
    );
    return {
      value: trackInputValue(resolveTrackOverride(trackId, kind, available)),
      options: buildTrackInputOptions(devices[kind], defaultLabel),
      onChange: (value) =>
        writeTrackInputOverride(trackId, kind, parseTrackInputValue(value)),
      deviceId: resolved[kind],
    };
  }

  const [video, audio] = RECORD_INPUT_KINDS.map(field);
  return (
    <div className="fx-device-panel__body track-record-device__body">
      <RecordInputPicker
        audio={audio}
        onStreamGranted={refresh}
        video={video}
      />
    </div>
  );
}

// The selected source track's Record device, with the track's own Video
// and Audio inputs and an arm button kept in step with the one on the
// track handle. Like an effect device it folds into a strip: collapsed by
// default, and expanded while the track is armed.
export function TrackRecordDevice({
  trackId,
  trackName,
}: TrackRecordDeviceProps) {
  const armed = useTrackArmed(trackId);
  const [fold, setFold] = useState(() => initialRecordDeviceFold(armed));
  const [foldArmed, setFoldArmed] = useState(armed);
  if (armed !== foldArmed) {
    setFoldArmed(armed);
    setFold(foldOnArmChange(fold, armed));
  }
  const name = trackName ?? "this track";
  const toggleArmed = () => toggleTrackArmed(trackId);
  const toggleFold = () => setFold(toggleRecordDeviceFold);
  const className = [
    "fx-device-panel",
    "track-record-device",
    fold.expanded ? "" : "fx-device-panel--collapsed",
    armed ? "track-record-device--armed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!fold.expanded) {
    return (
      <section aria-label={`Record ${name}`} className={className}>
        <ArmButton
          armed={armed}
          compact
          onToggle={toggleArmed}
          trackName={name}
        />
        <button
          aria-expanded={false}
          aria-label="Expand Record"
          className="fx-device-panel__strip"
          onClick={toggleFold}
          title="Expand Record"
          type="button"
        >
          <span>Record</span>
        </button>
      </section>
    );
  }

  return (
    <section aria-label={`Record ${name}`} className={className}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: double-clicking the title folds the device; its collapse button is the keyboard equivalent */}
      <header
        className="fx-device-panel__title"
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) {
            toggleFold();
          }
        }}
      >
        <ArmButton armed={armed} onToggle={toggleArmed} trackName={name} />
        <span className="fx-device-panel__name">Record</span>
        <button
          aria-expanded
          aria-label="Collapse Record"
          className="fx-device-panel__collapse"
          onClick={toggleFold}
          title="Collapse Record"
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" />
        </button>
      </header>
      <TrackRecordInputs trackId={trackId} />
    </section>
  );
}
