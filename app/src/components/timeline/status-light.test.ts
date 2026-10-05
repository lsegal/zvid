import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getStatusLightClassName,
  getStatusLightState,
  STATUS_LIGHT_LABELS,
} from "./status-light.ts";

function light(isPlaying: boolean, isRecording: boolean) {
  const state = getStatusLightState(isPlaying, isRecording);
  return {
    className: getStatusLightClassName(state),
    label: STATUS_LIGHT_LABELS[state],
  };
}

describe("status light", () => {
  it("is the default yellow light labeled Stopped when stopped", () => {
    assert.deepEqual(light(false, false), {
      className: "status-light",
      label: "Stopped",
    });
  });

  it("is green and labeled Playing while playing", () => {
    assert.deepEqual(light(true, false), {
      className: "status-light status-light--playing",
      label: "Playing",
    });
  });

  it("is red and labeled Recording while recording", () => {
    assert.deepEqual(light(false, true), {
      className: "status-light status-light--recording",
      label: "Recording",
    });
  });

  it("prefers recording over playing", () => {
    assert.deepEqual(light(true, true), {
      className: "status-light status-light--recording",
      label: "Recording",
    });
  });
});
