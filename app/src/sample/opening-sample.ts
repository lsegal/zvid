// The zvid opening sample: a 30-second opening sequence built from native
// layers, cuts, effects, text and animation. Its template and manifest are
// written by scripts/sample/build-opening-sample.mjs, and bundled so a warm
// media cache opens it offline.

import { OPENING_SAMPLE_MANIFEST } from "./opening-manifest.generated.ts";
import openingSessionText from "./zvid-opening.project.json?raw";

export const OPENING_SAMPLE = {
  manifest: OPENING_SAMPLE_MANIFEST,
  sessionText: openingSessionText,
};
