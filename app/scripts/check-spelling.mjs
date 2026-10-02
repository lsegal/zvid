#!/usr/bin/env node
// Fails when a tracked file uses a British spelling. The project uses
// American English, but British spellings keep arriving from issue text that
// pull requests copy into comments, strings, test names and identifiers.
//
// Usage: node app/scripts/check-spelling.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// British stems, matched case-insensitively anywhere in a word so camelCase
// and PascalCase identifiers are caught too, with the American spelling.
export const BRITISH = [
  ["colour", "color"],
  ["behaviour", "behavior"],
  ["favour", "favor"],
  ["flavour", "flavor"],
  ["honour", "honor"],
  ["harbour", "harbor"],
  ["neighbour", "neighbor"],
  ["labour", "labor"],
  ["rumour", "rumor"],
  ["armour", "armor"],
  ["centre", "center"],
  ["metre", "meter"],
  ["litre", "liter"],
  ["fibre", "fiber"],
  ["theatre", "theater"],
  ["grey", "gray"],
  ["analogue", "analog"],
  ["catalogue", "catalog"],
  ["programme", "program"],
  ["licence", "license"],
  ["defence", "defense"],
  ["offence", "offense"],
  ["artefact", "artifact"],
  ["whilst", "while"],
  ["amongst", "among"],
  ["manoeuvr", "maneuver"],
  ["ageing", "aging"],
  ["enrolment", "enrollment"],
  ["focussed", "focused"],
  ["focussing", "focusing"],
  ["cancelled", "canceled"],
  ["cancelling", "canceling"],
  ["labelled", "labeled"],
  ["labelling", "labeling"],
  ["modelled", "modeled"],
  ["modelling", "modeling"],
  ["levelled", "leveled"],
  ["levelling", "leveling"],
  ["signalled", "signaled"],
  ["signalling", "signaling"],
  ["travelled", "traveled"],
  ["travelling", "traveling"],
  ["channelled", "channeled"],
  ["tunnelled", "tunneled"],
  ["funnelled", "funneled"],
  ["totalled", "totaled"],
  ["fuelled", "fueled"],
  ["dialled", "dialed"],
  ["panelled", "paneled"],
  ["rivalled", "rivaled"],
  ["analyse", "analyze"],
  ["analysed", "analyzed"],
  ["analysing", "analyzing"],
  ["paralys", "paralyz"],
  ...[
    "authoris",
    "capitalis",
    "categoris",
    "customis",
    "deserialis",
    "digitis",
    "emphasis",
    "equalis",
    "finalis",
    "harmonis",
    "initialis",
    "localis",
    "materialis",
    "maximis",
    "memoris",
    "minimis",
    "normalis",
    "optimis",
    "organis",
    "parallelis",
    "prioritis",
    "quantis",
    "randomis",
    "rasteris",
    "recognis",
    "sanitis",
    "serialis",
    "stabilis",
    "standardis",
    "summaris",
    "synchronis",
    "tokenis",
    "utilis",
    "visualis",
  ].map((stem) => [`${stem}e`, `${stem.slice(0, -1)}ze`]),
  ...[
    "normalis",
    "initialis",
    "serialis",
    "organis",
    "optimis",
    "visualis",
  ].flatMap((stem) => [
    [`${stem}ing`, `${stem.slice(0, -1)}zing`],
    [`${stem}ation`, `${stem.slice(0, -1)}zation`],
  ]),
];

// Words containing a British stem that are external names, so they stay:
// the Web Audio API's AnalyserNode and createAnalyser (and the `analyser`
// variables that hold one), the HTML attribute aria-labelledby, the GitHub
// Actions cancelled() function, and plain English words that merely contain
// a stem.
const ALLOWED_WORDS =
  /^(\w*analyser\w*(\(\))?|[\w-]*labelledby|cancelled\(\)|emphasis|emphases|analyses|programmers?)$/i;

const SKIPPED_FILES = new Set([
  "app/scripts/check-spelling.mjs",
  "app/scripts/check-spelling.test.mjs",
]);
// Lockfiles name third-party packages.
const SKIPPED_PATHS = /(^|\/)(pnpm-lock\.yaml|Cargo\.lock|package-lock\.json)$/;

const PATTERN = new RegExp(
  `[\\w-]*(${BRITISH.map(([british]) => british)
    .sort((a, b) => b.length - a.length)
    .join("|")})[\\w-]*(\\(\\))?`,
  "gi",
);
const AMERICAN = new Map(BRITISH);

/** Returns `{ line, word, british, american }` for each British spelling in
 * `text`, with 1-based line numbers. */
export function findBritishSpellings(text) {
  const found = [];
  text.split("\n").forEach((content, index) => {
    for (const match of content.matchAll(PATTERN)) {
      const word = match[0];
      if (ALLOWED_WORDS.test(word)) continue;
      const british = match[1].toLowerCase();
      // "emphasise" contains "emphasis", which is fine on its own.
      if (british === "emphasise" && /emphas[ie]s\b/i.test(word)) continue;
      found.push({
        line: index + 1,
        word,
        british,
        american: AMERICAN.get(british),
      });
    }
  });
  return found;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repoDir,
    encoding: "utf8",
  })
    .split("\0")
    .filter(
      (path) => path && !SKIPPED_FILES.has(path) && !SKIPPED_PATHS.test(path),
    );
}

function main() {
  let count = 0;
  for (const path of trackedFiles()) {
    let buffer;
    try {
      buffer = readFileSync(join(repoDir, path));
    } catch {
      continue;
    }
    if (buffer.includes(0)) continue;
    for (const { line, word, british, american } of findBritishSpellings(
      buffer.toString("utf8"),
    )) {
      console.error(
        `${path}:${line}: "${word}" uses British "${british}"; use "${american}"`,
      );
      count++;
    }
  }
  if (count > 0) {
    console.error(
      `\n${count} British spelling(s). The project uses American English.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
