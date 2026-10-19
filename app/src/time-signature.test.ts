import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionToProject } from "./app/session-project.ts";
import { projectToSession } from "./session-save.ts";
import {
  DEFAULT_SIGNATURE,
  parseSignature,
  SIGNATURE_LADDER,
  signatureBeatScale,
  signatureById,
  stepSignature,
} from "./time-signature.ts";
import {
  divisionQuarters,
  getGridLayers,
  resolveAdaptiveDivision,
} from "./timeline-grid.ts";

const ids = (signatures: readonly { id: string }[]) =>
  signatures.map(({ id }) => id);

describe("parseSignature", () => {
  it("parses any N/M of positive whole numbers", () => {
    assert.deepEqual(parseSignature("7/5"), {
      id: "7/5",
      numerator: 7,
      denominator: 5,
    });
    assert.equal(parseSignature("13/8")?.id, "13/8");
    assert.equal(parseSignature(" 07 / 05 ")?.id, "7/5");
  });

  it("rejects anything else", () => {
    for (const text of ["", "4", "4/", "/4", "0/4", "4/0", "-3/4", "3.5/4"]) {
      assert.equal(parseSignature(text), null, text);
    }
    assert.equal(parseSignature("4/100"), null);
    assert.equal(parseSignature("99/99")?.id, "99/99");
  });
});

describe("signatureById", () => {
  it("resolves a custom signature instead of falling back to 4/4", () => {
    assert.deepEqual(signatureById("7/5"), {
      id: "7/5",
      numerator: 7,
      denominator: 5,
    });
  });

  it("falls back to 4/4 for an id that isn't N/M", () => {
    assert.equal(signatureById("waltz"), DEFAULT_SIGNATURE);
  });

  it("gives the same object for the same id", () => {
    assert.equal(signatureById("13/8"), signatureById("13/8"));
  });
});

describe("SIGNATURE_LADDER", () => {
  it("runs from 1/1 through 12/4 with the /3, /5 and /7 denominators", () => {
    const ladder = ids(SIGNATURE_LADDER);
    assert.equal(ladder[0], "1/1");
    assert.deepEqual(ladder.slice(0, 7), [
      "1/1",
      "1/2",
      "1/3",
      "1/4",
      "1/5",
      "1/7",
      "1/8",
    ]);
    for (const id of ["2/2", "3/3", "3/4", "4/4", "7/5", "5/7", "12/4"]) {
      assert.ok(ladder.includes(id), id);
    }
    assert.equal(ladder.length, 12 * 7);
    assert.equal(new Set(ladder).size, ladder.length);
  });
});

describe("stepSignature", () => {
  it("steps along the ladder in both directions", () => {
    assert.equal(stepSignature(signatureById("4/4"), 1)?.id, "4/5");
    assert.equal(stepSignature(signatureById("4/4"), -1)?.id, "4/3");
    assert.equal(stepSignature(signatureById("3/8"), 1)?.id, "4/1");
    assert.equal(stepSignature(signatureById("4/1"), -1)?.id, "3/8");
  });

  it("stops at either end", () => {
    assert.equal(stepSignature(signatureById("1/1"), -1), null);
    assert.equal(
      stepSignature(SIGNATURE_LADDER.at(-1) ?? DEFAULT_SIGNATURE, 1),
      null,
    );
  });

  it("steps a custom signature to the nearer rung on each side", () => {
    assert.equal(stepSignature(signatureById("3/6"), 1)?.id, "3/7");
    assert.equal(stepSignature(signatureById("3/6"), -1)?.id, "3/5");
    assert.equal(stepSignature(signatureById("13/8"), 1), null);
    assert.equal(stepSignature(signatureById("13/8"), -1)?.id, "12/8");
  });
});

describe("signatureBeatScale", () => {
  it("leaves power-of-two beats alone", () => {
    for (const id of ["1/1", "3/2", "4/4", "6/8", "5/16"]) {
      assert.equal(signatureBeatScale(signatureById(id)), 1, id);
    }
  });

  // At any zoom, the snap unit the timeline uses divides the beat or is a
  // whole number of beats, so snapping lands on beats and bar lines.
  it("keeps the snap unit on the beats of any denominator", () => {
    for (const id of ["3/3", "7/5", "5/7", "13/6", "4/12", "2/99"]) {
      const signature = signatureById(id);
      const beatQ = 4 / signature.denominator;
      const scale = signatureBeatScale(signature);
      for (const quarterPx of [2, 7, 28, 90, 400]) {
        const snapQ =
          divisionQuarters(resolveAdaptiveDivision(quarterPx * scale)) * scale;
        const ratio = snapQ > beatQ ? snapQ / beatQ : beatQ / snapQ;
        assert.ok(
          Math.abs(ratio - Math.round(ratio)) < 1e-9,
          `${id} at ${quarterPx}px: ${snapQ} vs a ${beatQ} beat`,
        );
      }
    }
  });

  it("draws 7/5 bar lines 5.6 quarters apart", () => {
    const signature = signatureById("7/5");
    const scale = signatureBeatScale(signature);
    const layers = getGridLayers(divisionQuarters(4) * scale, signature);
    assert.deepEqual(
      layers.map(({ spacingQ, weight }) => [weight, spacingQ.toFixed(3)]),
      [
        ["beat", "0.800"],
        ["bar", "5.600"],
      ],
    );
  });
});

describe("the time signature in a session", () => {
  it("survives saving and opening the session", () => {
    const project = {
      bpm: 120,
      fps: 30,
      canvasWidth: 1080,
      canvasHeight: 1920,
      zoom: 1,
      timelineMode: "musical",
      snapEnabled: true,
      signatureId: "13/8",
      lanes: [],
      sourceTracks: [],
      sourceSpans: [],
      clips: [],
      effects: [],
      mediaItems: [],
    };
    const session = projectToSession(project, { playheadQ: 0 });
    assert.equal(session.timeline?.timeSignature, "13/8");
    const reopened = JSON.parse(JSON.stringify(session));
    assert.equal(sessionToProject(reopened, []).signatureId, "13/8");
  });

  it("opens as 4/4 without one, or with one that isn't N/M", () => {
    assert.equal(sessionToProject({}, []).signatureId, "4/4");
    assert.equal(
      sessionToProject({ timeline: { timeSignature: "fast" } }, []).signatureId,
      "4/4",
    );
  });
});
