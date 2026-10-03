import { useCallback, useEffect, useState } from "react";

type DeviceInfo = Pick<
  MediaDeviceInfo,
  "deviceId" | "groupId" | "kind" | "label"
>;

// The browser's media devices, refreshed as cameras and microphones are
// attached or removed (webcams, virtual and continuity cameras, audio
// interfaces), like a DAW's input list. `ready` is false until the first
// list arrives. Call `refresh` once a stream is granted: browsers name
// devices only after the page may use them.
export function useMediaInputDevices() {
  const [infos, setInfos] = useState<readonly DeviceInfo[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) {
      setReady(true);
      return;
    }
    mediaDevices.enumerateDevices().then(
      (list) => {
        setInfos(list);
        setReady(true);
      },
      () => setReady(true),
    );
  }, []);

  useEffect(() => {
    refresh();
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  return { infos, ready, refresh };
}
