import {
  getInputConstraint,
  type RecordDevice,
  type RecordInput,
  type RecordInputKind,
} from "./record-inputs.ts";

// What the picker needs of navigator.mediaDevices.
export type MediaDevicesLike = Pick<
  MediaDevices,
  "enumerateDevices" | "getUserMedia"
> &
  Partial<Pick<MediaDevices, "addEventListener" | "removeEventListener">>;

const DEVICE_KINDS: Partial<Record<MediaDeviceKind, RecordInputKind>> = {
  videoinput: "video",
  audioinput: "audio",
};

const FALLBACK_LABELS: Record<RecordInputKind, string> = {
  video: "Camera",
  audio: "Microphone",
};

export function getMediaDevices(): MediaDevicesLike | null {
  return globalThis.navigator?.mediaDevices ?? null;
}

// Every camera and mic input, webcams and attached remote or virtual devices
// alike. Before permission is granted browsers hide the labels, so those
// read "Camera 1", "Microphone 1" and so on.
export async function listRecordDevices(
  mediaDevices: MediaDevicesLike,
): Promise<RecordDevice[]> {
  const counts: Record<RecordInputKind, number> = { video: 0, audio: 0 };
  const devices: RecordDevice[] = [];
  for (const device of await mediaDevices.enumerateDevices()) {
    const kind = DEVICE_KINDS[device.kind];
    if (!kind) {
      continue;
    }
    counts[kind] += 1;
    devices.push({
      kind,
      deviceId: device.deviceId,
      label: device.label || `${FALLBACK_LABELS[kind]} ${counts[kind]}`,
    });
  }
  return devices;
}

export type PreviewStreamError = "denied" | "missing" | "unavailable";

export type PreviewStreamResult =
  | { stream: MediaStream | null; error?: undefined }
  | { stream?: undefined; error: PreviewStreamError };

// Opens `input` for a preview: no stream for None, or why it couldn't open.
export async function openPreviewStream(
  mediaDevices: MediaDevicesLike | null,
  kind: RecordInputKind,
  input: RecordInput,
): Promise<PreviewStreamResult> {
  if (input === null) {
    return { stream: null };
  }
  if (!mediaDevices) {
    return { error: "unavailable" };
  }
  try {
    const constraint = getInputConstraint(input);
    const stream = await mediaDevices.getUserMedia(
      kind === "video"
        ? { video: constraint, audio: false }
        : { video: false, audio: constraint },
    );
    return { stream };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { error: "denied" };
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return { error: "missing" };
    }
    return { error: "unavailable" };
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

export function describePreviewError(
  kind: RecordInputKind,
  error: PreviewStreamError,
) {
  const device = kind === "video" ? "Camera" : "Microphone";
  switch (error) {
    case "denied":
      return `${device} access was denied. Allow it in your browser's site settings, then pick a ${device.toLowerCase()}.`;
    case "missing":
      return `This ${device.toLowerCase()} isn't connected.`;
    default:
      return `The ${device.toLowerCase()} couldn't be opened.`;
  }
}
