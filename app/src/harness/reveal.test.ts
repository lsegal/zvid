import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SaveTarget } from "./contracts";
import { canRevealSavedFile } from "./reveal.ts";

const nativeTarget: SaveTarget = {
  kind: "native-path",
  filename: "export.mp4",
  path: "/Users/me/Movies/export.mp4",
};

const revealSavedFile = async () => {};

describe("canRevealSavedFile", () => {
  it("reveals native path saves when the harness supports it", () => {
    assert.equal(
      canRevealSavedFile(
        { capabilities: { "reveal-saved-file": true }, revealSavedFile },
        nativeTarget,
      ),
      true,
    );
  });

  it("does not reveal without the capability", () => {
    assert.equal(
      canRevealSavedFile(
        { capabilities: { "browser-dialogs": true }, revealSavedFile },
        nativeTarget,
      ),
      false,
    );
    assert.equal(
      canRevealSavedFile(
        { capabilities: { "reveal-saved-file": true } },
        nativeTarget,
      ),
      false,
    );
    assert.equal(canRevealSavedFile(undefined, nativeTarget), false);
  });

  it("does not reveal downloads, picker handles or missing targets", () => {
    const harness = {
      capabilities: { "reveal-saved-file": true },
      revealSavedFile,
    };
    assert.equal(
      canRevealSavedFile(harness, { kind: "download", filename: "export.mp4" }),
      false,
    );
    assert.equal(
      canRevealSavedFile(harness, {
        kind: "picker",
        filename: "export.mp4",
        handle: {
          createWritable: async () => ({
            write: async () => {},
            close: async () => {},
          }),
        },
      }),
      false,
    );
    assert.equal(canRevealSavedFile(harness, null), false);
  });
});
