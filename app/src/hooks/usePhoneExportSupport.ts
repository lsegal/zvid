import { canEncodeVideo } from "mediabunny";
import { useEffect, useState } from "react";
import { MEDIABUNNY_VIDEO_CODECS } from "../harness/export-encoding.ts";
import { findPhoneExportCodec } from "../mobile/export-support.ts";

// A typical phone export's bitrate, enough to ask the encoder about.
const PROBE_BITRATE = 8_000_000;

export type PhoneExportSupport = "checking" | "supported" | "unsupported";

// Whether this browser can export the session at its size on a phone
// (HEVC or AV1), checked once the mobile shell is showing.
export function usePhoneExportSupport(
  enabled: boolean,
  width: number,
  height: number,
): PhoneExportSupport {
  const [support, setSupport] = useState<PhoneExportSupport>("checking");
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let canceled = false;
    void findPhoneExportCodec((codec) =>
      canEncodeVideo(MEDIABUNNY_VIDEO_CODECS[codec], {
        width,
        height,
        bitrate: PROBE_BITRATE,
      }),
    ).then((codec) => {
      if (!canceled) {
        setSupport(codec ? "supported" : "unsupported");
      }
    });
    return () => {
      canceled = true;
    };
  }, [enabled, height, width]);
  return support;
}
