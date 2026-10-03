import { useState, useSyncExternalStore } from "react";
import {
  buildDefaultInputOptions,
  defaultInputValue,
  describeDeniedInput,
  parseDefaultInputValue,
} from "../../recording/default-record-inputs.ts";
import {
  type RecordInputField,
  RecordInputPicker,
} from "../../recording/RecordInputPicker";
import {
  type AvailableInputs,
  browserDefaultLabel,
  getRecordInputsVersion,
  listInputDevices,
  RECORD_INPUT_KINDS,
  type RecordInputKind,
  resolveDefaultInput,
  subscribeRecordInputs,
  writeDefaultInput,
} from "../../recording/record-inputs.ts";
import { useMediaInputDevices } from "../../recording/use-media-input-devices.ts";

type RecordTabProps = {
  // Whether the user has asked for the inputs this page load. Until then
  // nothing asks for camera or mic access.
  requested: boolean;
  onRequest: () => void;
};

// The default Video and Audio inputs. Mounted only while shown, so its
// previews stop when the tab is hidden or the drawer closes.
function DefaultRecordInputs() {
  const { infos, ready, refresh } = useMediaInputDevices();
  const [denied, setDenied] = useState<
    Partial<Record<RecordInputKind, boolean>>
  >({});
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

  function field(kind: RecordInputKind): RecordInputField {
    const input = resolveDefaultInput(kind, available);
    return {
      value: defaultInputValue(input),
      options: buildDefaultInputOptions(
        devices[kind],
        browserDefaultLabel(infos, kind),
      ),
      onChange: (value) => {
        setDenied((current) => ({ ...current, [kind]: false }));
        writeDefaultInput(kind, parseDefaultInputValue(value));
      },
      // Previews wait for the device list, so a saved device that is gone
      // isn't opened.
      deviceId: ready ? input : null,
    };
  }

  // Denied, the input stays None until the user picks again.
  const handleDenied = (kind: RecordInputKind) => {
    setDenied((current) => ({ ...current, [kind]: true }));
    writeDefaultInput(kind, null);
  };

  const [video, audio] = RECORD_INPUT_KINDS.map(field);
  return (
    <>
      <RecordInputPicker
        audio={audio}
        onStreamDenied={handleDenied}
        onStreamGranted={refresh}
        video={video}
      />
      {RECORD_INPUT_KINDS.filter((kind) => denied[kind]).map((kind) => (
        <p className="media-drawer__record-error" key={kind} role="alert">
          {describeDeniedInput(kind)}
        </p>
      ))}
    </>
  );
}

// The Media drawer's Record tab: the default camera and mic that recording
// into a source track uses, unless the track overrides them.
export function RecordTab({ requested, onRequest }: RecordTabProps) {
  return (
    <div className="media-drawer__record">
      <h2 className="media-drawer__record-title">Record</h2>
      <p className="media-drawer__record-subtitle">
        Configure your record inputs
      </p>
      {requested ? (
        <DefaultRecordInputs />
      ) : (
        <button
          className="ghost-button ghost-button--accent"
          onClick={onRequest}
          type="button"
        >
          Show Inputs
        </button>
      )}
    </div>
  );
}
