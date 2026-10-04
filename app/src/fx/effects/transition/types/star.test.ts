import { describe, it } from "node:test";
import { assertIris } from "../type-test-utils.ts";
import { transitionType } from "./star.ts";

describe("Star transition", () => {
  it("opens B out of the center or closes A into it", () => {
    assertIris(transitionType);
  });
});
