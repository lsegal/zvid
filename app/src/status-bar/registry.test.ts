import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusItemProviders } from "./registry.ts";

describe("status item providers", () => {
  it("lists every provider once, in bar order", () => {
    assert.deepEqual(
      statusItemProviders.map(({ id, order }) => `${order} ${id}`),
      [
        "10 version",
        "20 session",
        "30 timeline",
        "40 playhead",
        "50 resolution",
        "60 audio",
        "70 collaboration",
        "80 content",
        "90 media",
      ],
    );
  });
});
