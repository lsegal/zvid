import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findPhoneExportCodec } from "./export-support.ts";

describe("findPhoneExportCodec", () => {
  it("prefers HEVC", async () => {
    assert.equal(await findPhoneExportCodec(async () => true), "hevc");
  });

  it("falls back to AV1", async () => {
    assert.equal(
      await findPhoneExportCodec(async (codec) => codec === "av1"),
      "av1",
    );
  });

  it("finds nothing when neither encodes or the probe fails", async () => {
    assert.equal(await findPhoneExportCodec(async () => false), null);
    assert.equal(
      await findPhoneExportCodec(() => Promise.reject(new Error("no"))),
      null,
    );
  });
});
