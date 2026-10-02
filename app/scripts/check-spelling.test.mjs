import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBritishSpellings } from "./check-spelling.mjs";

describe("findBritishSpellings", () => {
  it("finds British spellings in prose with their line and fix", () => {
    assert.deepEqual(
      findBritishSpellings(
        "// fine\n// A tone centred between neighbouring samples.",
      ),
      [
        { line: 2, word: "centred", british: "centre", american: "center" },
        {
          line: 2,
          word: "neighbouring",
          british: "neighbour",
          american: "neighbor",
        },
      ],
    );
  });

  it("finds British spellings inside identifiers", () => {
    assert.deepEqual(
      findBritishSpellings("class SampleLoadCancelledError {}").map(
        ({ word, american }) => [word, american],
      ),
      [["SampleLoadCancelledError", "canceled"]],
    );
    assert.deepEqual(
      findBritishSpellings("const fillColour = normaliseGain(x);").map(
        ({ word }) => word,
      ),
      ["fillColour", "normaliseGain"],
    );
  });

  it("allows external names and words that merely contain a stem", () => {
    assert.deepEqual(
      findBritishSpellings(
        [
          "const analyser: AnalyserNode = context.createAnalyser();",
          "probeAnalysers.push(analyser);",
          '<div aria-labelledby="title" />',
          "if: cancelled()",
          "The analyses put emphasis on programmers.",
          "A centered, gray, normalized, canceled color.",
        ].join("\n"),
      ),
      [],
    );
  });
});
