import { describe, it } from "node:test";
import { assertIris } from "../type-test-utils.ts";
import { transitionType } from "./iris.ts";

describe("Iris transition", () => {
  it("opens B out of the center or closes A into it", () => {
    assertIris(transitionType);
  });
});
