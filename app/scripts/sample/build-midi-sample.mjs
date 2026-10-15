// Keeps the zvid MIDI sample in step: its editable session template
// `src/sample/zvid-midi.project.json` and the asset manifest
// `src/sample/midi-manifest.generated.ts`, hashed from the media in
// `public/samples/midi-v1`.
//
//   node app/scripts/sample/build-midi-sample.mjs [--check]
//   node app/scripts/sample/build-midi-sample.mjs --import <file.zvd>
//
// The session is edited in zvid and saved as a .zvd. `--import` reads one,
// copies its media into `public/samples/midi-v1` under the names in MEDIA,
// rewrites its `media/...` references as `zvid-sample://midi-v1/...` paths,
// and writes the template and manifest. With no option it rewrites the
// manifest; `--check` fails when either file doesn't match what would be
// written, or the session refers to media the manifest doesn't carry.
//
// A 12-bar electro track in D major, 120 BPM, whose every sound is
// generated: MIDI clips play through a Drum Rack (its banks are
// synthesized, see scripts/gen-drum-banks.mjs), Synths, an Arpeggiator and a
// Granular, each with audio effects stacked after it. No clip plays recorded
// audio. The picture is LottieFiles animations and the zvid logo.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE_VERSION = "midi-v1";
const MEDIA_DIR = resolve(APP, "public/samples", SAMPLE_VERSION);
const SESSION_FILE = resolve(APP, "src/sample/zvid-midi.project.json");
const MANIFEST_FILE = resolve(APP, "src/sample/midi-manifest.generated.ts");

const samplePath = (name) => `zvid-sample://${SAMPLE_VERSION}/${name}`;

const LOTTIE_CREDIT = (title, issue) =>
  `"${title}" from LottieFiles (lottiefiles.com), free under the Lottie ` +
  `Simple License; supplied for this sample in issue #${issue}.`;
const ICON_CREDIT = "The zvid logo, zvid's own artwork.";

// The sample's media: `source` is the file's name in the .zvd, `file` its
// name here. Bump SAMPLE_VERSION whenever a file's bytes change.
const MEDIA = [
  {
    key: "forest",
    source: "forest-morning.lottie",
    file: "forest-morning.lottie",
    mediaType: "application/zip",
    credit: LOTTIE_CREDIT("Forest Morning", 1415),
  },
  {
    key: "dots",
    source: "gradient-dots.lottie",
    file: "gradient-dots.lottie",
    mediaType: "application/zip",
    credit: LOTTIE_CREDIT("Gradient Dots Background", 1415),
  },
  {
    key: "sky",
    source: "Background Full Screen.lottie",
    file: "background-full-screen.lottie",
    mediaType: "application/zip",
    credit: LOTTIE_CREDIT("Background Full Screen", 1435),
  },
  {
    key: "train",
    source: "Background Full Screen-Train.lottie",
    file: "background-full-screen-train.lottie",
    mediaType: "application/zip",
    credit: LOTTIE_CREDIT("Background Full Screen (Train)", 1435),
  },
  {
    key: "zvid-logo",
    source: "zvid-logo.svg",
    file: "zvid-logo.svg",
    mediaType: "image/svg+xml",
    credit: ICON_CREDIT,
  },
];

// ---- import --------------------------------------------------------------

// The files of a .zvd: a gzipped ustar archive of `project.json` and
// `media/*`.
function readZvd(file) {
  const tar = gunzipSync(readFileSync(file));
  const entries = new Map();
  const field = (block, start, length) =>
    block
      .subarray(start, start + length)
      .toString("utf8")
      .replace(/\0.*$/s, "");
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const name = field(header, 0, 100);
    if (!name) {
      break;
    }
    const prefix = field(header, 345, 155);
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = field(header, 156, 1);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (type === "" || type === "0") {
      entries.set(prefix ? `${prefix}/${name}` : name, Buffer.from(body));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

// Rewrites every string `media/<source>` (and `Custom:media/<source>`) in
// `value` as the sample path of that file.
function remapMedia(value) {
  if (typeof value === "string") {
    for (const media of MEDIA) {
      const from = `media/${media.source}`;
      if (value === from || value.endsWith(`:${from}`)) {
        return value.slice(0, -from.length) + samplePath(media.file);
      }
    }
    if (/(^|:)media\//.test(value)) {
      throw new Error(`No sample media for ${value}; add it to MEDIA.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(remapMedia);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapMedia(item)]),
    );
  }
  return value;
}

// The session as the sample opens it: at the start and with nothing
// selected. The timeline keeps the zoom it was saved at (90%, #1467).
function normalizeSession(session) {
  const strip = (value) => {
    if (Array.isArray(value)) {
      return value.map(strip);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== "selected")
          .map(([key, item]) => [key, strip(item)]),
      );
    }
    return value;
  };
  return {
    ...strip(session),
    playPosition: 0,
    playStartPosition: 0,
  };
}

function importZvd(file) {
  const entries = readZvd(file);
  const project = entries.get("project.json");
  if (!project) {
    throw new Error(`${file} has no project.json`);
  }
  mkdirSync(MEDIA_DIR, { recursive: true });
  for (const media of MEDIA) {
    const bytes = entries.get(`media/${media.source}`);
    if (bytes) {
      writeFileSync(resolve(MEDIA_DIR, media.file), bytes);
    }
  }
  const session = normalizeSession(
    remapMedia(JSON.parse(project.toString("utf8"))),
  );
  writeFileSync(SESSION_FILE, `${JSON.stringify(session, null, 2)}\n`);
}

// ---- manifest ------------------------------------------------------------

function asset(media) {
  const bytes = readFileSync(resolve(MEDIA_DIR, media.file));
  return {
    id: `zvid-sample:${SAMPLE_VERSION}:${media.key}`,
    path: samplePath(media.file),
    url: `/samples/${SAMPLE_VERSION}/${media.file}`,
    name: media.file,
    mediaType: media.mediaType,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    credit: media.credit,
  };
}

function manifestText() {
  const manifest = {
    id: "zvid-midi",
    version: SAMPLE_VERSION,
    sessionName: "zvid MIDI sample",
    creditsUrl: `/samples/${SAMPLE_VERSION}/CREDITS.md`,
    assets: MEDIA.map(asset),
  };
  return `// Generated by scripts/sample/build-midi-sample.mjs; do not edit.
import type { SampleManifest } from "./sample-manifest.ts";

export const MIDI_SAMPLE_MANIFEST: SampleManifest = ${JSON.stringify(manifest, null, 2)};
`;
}

// Problems with the committed session: text that isn't what an import
// writes, and sample paths the manifest doesn't carry.
function sessionProblems() {
  const text = readFileSync(SESSION_FILE, "utf8");
  const session = JSON.parse(text);
  const problems = [];
  if (text !== `${JSON.stringify(normalizeSession(session), null, 2)}\n`) {
    problems.push(`${SESSION_FILE} is not normalized`);
  }
  const known = new Set(MEDIA.map((media) => samplePath(media.file)));
  for (const path of text.match(/zvid-sample:\/\/[^"]+/g) ?? []) {
    if (!known.has(path)) {
      problems.push(`${SESSION_FILE} refers to ${path}, not in MEDIA`);
    }
  }
  if (/"(Custom:)?media\//.test(text)) {
    problems.push(`${SESSION_FILE} has unmapped media/ references`);
  }
  return problems;
}

const importIndex = process.argv.indexOf("--import");
if (importIndex >= 0) {
  const file = process.argv[importIndex + 1];
  if (!file) {
    console.error("--import needs a .zvd file");
    process.exit(2);
  }
  importZvd(resolve(file));
}

const manifest = manifestText();
if (process.argv.includes("--check")) {
  const problems = sessionProblems();
  let current = "";
  try {
    current = readFileSync(MANIFEST_FILE, "utf8");
  } catch {}
  if (current !== manifest) {
    problems.push(
      `Out of date: ${MANIFEST_FILE}. Run node app/scripts/sample/build-midi-sample.mjs.`,
    );
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
} else {
  const problems = sessionProblems();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  writeFileSync(MANIFEST_FILE, manifest);
  console.log(
    `Wrote ${importIndex >= 0 ? `${SESSION_FILE} and ` : ""}${MANIFEST_FILE}`,
  );
}
