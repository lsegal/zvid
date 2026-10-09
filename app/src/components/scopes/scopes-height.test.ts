import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampScopesHeight,
  MIN_MONITOR_HEIGHT_PX,
  MIN_SCOPES_HEIGHT_PX,
} from "./scopes-height.ts";

describe("clampScopesHeight", () => {
  it("a Scopes panel height inside its limits is kept, rounded", () => {
    assert.equal(clampScopesHeight(200.4, 600), 200);
  });

  it("the Scopes panel is never shorter than its least height", () => {
    assert.equal(clampScopesHeight(10, 600), MIN_SCOPES_HEIGHT_PX);
    assert.equal(clampScopesHeight(-50, 600), MIN_SCOPES_HEIGHT_PX);
  });

  it("the Scopes panel leaves the monitor its least height", () => {
    assert.equal(clampScopesHeight(1000, 600), 600 - MIN_MONITOR_HEIGHT_PX);
  });

  it("a cramped preview keeps the Scopes panel at its least height", () => {
    assert.equal(clampScopesHeight(300, 150), MIN_SCOPES_HEIGHT_PX);
  });
});
