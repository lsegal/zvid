import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILT_IN_SIGNALING_URLS,
  migrateLegacyStoredSignaling,
  PUBLIC_SIGNALING_URL,
  ZVID_SIGNALING_URL,
} from "./signaling-servers.ts";

const DEFAULT = BUILT_IN_SIGNALING_URLS.join(", ");

describe("signaling defaults", () => {
  it("uses only the public relay", () => {
    assert.deepEqual(BUILT_IN_SIGNALING_URLS, [PUBLIC_SIGNALING_URL]);
  });

  it("uses the default when nothing is stored", () => {
    assert.equal(migrateLegacyStoredSignaling(undefined, DEFAULT), DEFAULT);
    assert.equal(migrateLegacyStoredSignaling(" , ", DEFAULT), DEFAULT);
  });

  it("moves the previous two-server default to the current default", () => {
    for (const stored of [
      `${ZVID_SIGNALING_URL}, ${PUBLIC_SIGNALING_URL}`,
      `${ZVID_SIGNALING_URL},${PUBLIC_SIGNALING_URL}`,
      `${ZVID_SIGNALING_URL}\n${PUBLIC_SIGNALING_URL}`,
    ]) {
      assert.equal(migrateLegacyStoredSignaling(stored, DEFAULT), DEFAULT);
    }
  });

  it("moves earlier single-server defaults to the current default", () => {
    for (const stored of [ZVID_SIGNALING_URL, PUBLIC_SIGNALING_URL]) {
      assert.equal(
        migrateLegacyStoredSignaling(stored, "wss://build.example"),
        "wss://build.example",
      );
    }
  });

  it("keeps custom settings", () => {
    assert.equal(
      migrateLegacyStoredSignaling("wss://mine.example", DEFAULT),
      "wss://mine.example",
    );
    assert.equal(
      migrateLegacyStoredSignaling(
        `${PUBLIC_SIGNALING_URL},wss://mine.example`,
        DEFAULT,
      ),
      `${PUBLIC_SIGNALING_URL}, wss://mine.example`,
    );
    assert.equal(
      migrateLegacyStoredSignaling(
        `${PUBLIC_SIGNALING_URL}, ${ZVID_SIGNALING_URL}`,
        DEFAULT,
      ),
      `${PUBLIC_SIGNALING_URL}, ${ZVID_SIGNALING_URL}`,
    );
  });
});
