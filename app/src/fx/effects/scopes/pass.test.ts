// The shader passes reference WebGL types.
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { params } from "../../pass-test-utils.ts";
import { createEffect } from "../../stack/ops.ts";
import { definition } from "./definition.ts";
import { pass } from "./pass.ts";

describe("Scopes pass", () => {
  it("is view only: the identity, never drawn into the picture", () => {
    assert.equal(pass.analyzes, true);
    assert.equal(pass.isIdentity?.(params({})), true);
    assert.match(pass.fragmentSource, /gl_FragColor = texture2D\(uTex, vUv\);/);
    assert.deepEqual(pass.uniforms, []);
  });
});

describe("Scopes definition", () => {
  it("is offered on every video stack, with a waveform and no knobs", () => {
    assert.deepEqual(definition.scopes, ["layer", "clip", "global", "fxClip"]);
    assert.deepEqual(
      definition.parameters.map((parameter) => parameter.kind),
      ["waveform"],
    );
  });

  it("stores no parameters and has no Animation", () => {
    const effect = createEffect("lane", "Scopes", "scopes");
    assert.deepEqual(effect.parameters, []);
    assert.equal(effect.animation, undefined);
  });
});
