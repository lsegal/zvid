import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bundledLutsIn,
  customLutMediaPath,
  customLutMediaPaths,
  customLutValue,
  describeLut,
  isNoLut,
} from "./lut.ts";

describe("LUT values", () => {
  it("stores a custom LUT by its media path", () => {
    const value = customLutValue("C:\\looks\\teal.cube");
    assert.equal(value, "Custom:C:\\looks\\teal.cube");
    assert.equal(customLutMediaPath(value), "C:\\looks\\teal.cube");
    assert.equal(customLutMediaPath("custom: teal.cube "), "teal.cube");
    assert.equal(customLutMediaPath("Custom:"), undefined);
    assert.equal(customLutMediaPath("Kodachrome"), undefined);
  });

  it("describes None, bundled and custom LUTs", () => {
    assert.equal(describeLut(""), "None");
    assert.equal(describeLut("none"), "None");
    assert.equal(describeLut("Kodachrome"), "Kodachrome");
    assert.equal(describeLut("builtin:warm-70s"), "Warm 70s Film");
    assert.equal(describeLut("Custom:/a/b/teal.cube"), "teal.cube");
    assert.equal(describeLut("Custom:C:\\a\\warm.cube"), "warm.cube");
    assert.equal(isNoLut(" None "), true);
    assert.equal(isNoLut("Custom:x.cube"), false);
  });

  it("lists the media paths of enabled custom LUTs once", () => {
    const lut = (value: string, enabled = true) => ({
      effectName: "LUT",
      enabled,
      parameters: [{ key: "LUT", value }],
    });
    assert.deepEqual(
      customLutMediaPaths([
        lut("Custom:a.cube"),
        lut("Custom:a.cube"),
        lut("Custom:b.cube", false),
        lut("None"),
        lut("Kodachrome"),
        {
          effectName: "Shape",
          parameters: [{ key: "LUT", value: "Custom:c.cube" }],
        },
        lut("Custom:d.cube"),
      ]),
      ["a.cube", "d.cube"],
    );
  });

  it("lists the bundled LUTs enabled LUTs use once", () => {
    const lut = (value: string, enabled = true) => ({
      effectName: "LUT",
      enabled,
      parameters: [{ key: "LUT", value }],
    });
    assert.deepEqual(
      bundledLutsIn([
        lut("builtin:sepia"),
        lut(" BUILTIN:SEPIA "),
        lut("builtin:bw-film", false),
        lut("builtin:missing"),
        lut("Custom:builtin:teal-orange"),
        lut("builtin:teal-orange"),
      ]).map((entry) => entry.id),
      ["builtin:sepia", "builtin:teal-orange"],
    );
  });
});
