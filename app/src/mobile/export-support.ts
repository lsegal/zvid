// Whether a phone browser can export at all. Phones only get Export when
// they can encode HEVC or AV1; otherwise the mobile shell points to the
// desktop app instead of letting an export fail partway.

export const PHONE_EXPORT_CODECS = ["hevc", "av1"] as const;

export type PhoneExportCodec = (typeof PHONE_EXPORT_CODECS)[number];

export type ExportProbe = (codec: PhoneExportCodec) => Promise<boolean>;

/** The first of HEVC and AV1 the browser encodes, or null for neither. */
export async function findPhoneExportCodec(
  probe: ExportProbe,
): Promise<PhoneExportCodec | null> {
  for (const codec of PHONE_EXPORT_CODECS) {
    if (await probe(codec).catch(() => false)) {
      return codec;
    }
  }
  return null;
}
