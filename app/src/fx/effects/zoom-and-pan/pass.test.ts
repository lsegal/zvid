// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEffect } from "../../../fx-stack.ts";
import { CONTEXT, params, uniformValues } from "../../pass-test-utils.ts";
import { pass } from "./pass.ts";

describe("Zoom & Pan pass", () => {
  it("clamps Zoom & Pan framings and the clip progress to 0..1", () => {
    const values = uniformValues(
      pass,
      params({
        _Start_Zoom: 0,
        _Start_X: 0.25,
        _Start_Y: 0.25,
        _End_Zoom: 1.4,
        _End_X: -0.5,
        _End_Y: 0.75,
      }),
      { ...CONTEXT, clipProgress: 1.2 },
    );

    assert.deepEqual(values.uStart, [0, 0.25, 0.25]);
    assert.deepEqual(values.uEnd, [1, 0, 0.75]);
    assert.deepEqual(values.uProgress, [1]);
  });

  it("flips Zoom & Pan Y on a bottom-up texture", () => {
    const parameters = params({ _Start_Y: 0, _End_Y: 0.25 });
    const topDown = uniformValues(pass, parameters);
    const bottomUp = uniformValues(pass, parameters, {
      ...CONTEXT,
      bottomUp: true,
    });

    assert.deepEqual(topDown.uStart, [0, 0.5, 0]);
    assert.deepEqual(topDown.uEnd, [0, 0.5, 0.25]);
    assert.deepEqual(bottomUp.uStart, [0, 0.5, 1]);
    assert.deepEqual(bottomUp.uEnd, [0, 0.5, 0.75]);
  });

  it("zooms a default Zoom & Pan from 1.0x to 1.2x across the clip", () => {
    const parameters = createEffect("1", "ZoomAndPan").parameters;
    // Mirrors the fragment shader's eased start-to-end zoom factor.
    const zoomAt = (clipProgress: number) => {
      const values = uniformValues(pass, parameters, {
        ...CONTEXT,
        clipProgress,
      });
      const [progress] = values.uProgress;
      const eased = progress * progress * (3 - 2 * progress);
      const zoom =
        values.uStart[0] + (values.uEnd[0] - values.uStart[0]) * eased;
      return 1 + 3 * zoom;
    };

    assert.match(pass.fragmentSource, /smoothstep\(0\.0, 1\.0, uProgress\)/);
    assert.match(pass.fragmentSource, /mix\(1\.0, 4\.0, k\.x\)/);
    assert.ok(Math.abs(zoomAt(0) - 1) < 1e-9);
    assert.ok(Math.abs(zoomAt(0.5) - 1.1) < 1e-9);
    assert.ok(Math.abs(zoomAt(1) - 1.2) < 1e-9);
  });

  it("centers a Zoom & Pan framing with missing parameters", () => {
    const values = uniformValues(pass, []);
    assert.deepEqual(values.uStart, [0, 0.5, 0.5]);
    assert.deepEqual(values.uEnd, [0, 0.5, 0.5]);
  });
});
