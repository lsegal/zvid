import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDeviceMaxHeight, resolveDeviceFit } from "./fx-device-fit.ts";

describe("resolveDeviceFit", () => {
  it("keeps the usual layout where nothing limits the height", () => {
    assert.deepEqual(resolveDeviceFit([], null, 4), {
      layout: 0,
      measure: false,
    });
  });

  it("tries each layout in turn until one fits", () => {
    assert.deepEqual(resolveDeviceFit([], 200, 4), {
      layout: 0,
      measure: true,
    });
    assert.deepEqual(resolveDeviceFit([300], 200, 4), {
      layout: 1,
      measure: true,
    });
    assert.deepEqual(resolveDeviceFit([300, 180], 200, 4), {
      layout: 1,
      measure: false,
    });
  });

  it("goes back to an earlier layout once the height allows it", () => {
    assert.deepEqual(resolveDeviceFit([300, 180], 320, 4), {
      layout: 0,
      measure: false,
    });
  });

  it("settles on the first of the shortest when none fits", () => {
    assert.deepEqual(resolveDeviceFit([229, 342, 229, 229], 200, 4), {
      layout: 0,
      measure: false,
    });
    assert.deepEqual(resolveDeviceFit([300, 240, 150, 150], 100, 4), {
      layout: 2,
      measure: false,
    });
  });
});

describe("getDeviceMaxHeight", () => {
  const chrome = { panelChrome: 40, chainChrome: 30 };

  it("holds a fitted panel's devices to the row's cap", () => {
    assert.equal(
      getDeviceMaxHeight({ resizedRow: null, fitCap: 288, ...chrome }),
      218,
    );
  });

  it("uses a resized panel's height", () => {
    assert.equal(
      getDeviceMaxHeight({ resizedRow: 400, fitCap: 288, ...chrome }),
      330,
    );
  });
});
