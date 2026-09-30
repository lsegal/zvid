// Copies the ZVID Capture plugin and zvid desktop app installers from the
// latest successful `DAW bundles` run on main into dist/downloads and writes
// the manifest the app's Help → Install Capture Plugin and Help → Download
// Desktop App dialogs read. wrangler.jsonc runs it after the Vite build
// (`pnpm run cf:prepare`), so every deploy carries the newest installers main
// has produced.
//
// Worker static assets are limited to 25 MiB each. A desktop app installer
// over that is left out, with a warning, rather than failing the deploy; the
// plugin installers are always included.
//
// Artifact downloads need a GitHub token: GH_TOKEN, GITHUB_TOKEN or
// `gh auth token`. Without one, or without artifacts, the build goes on with
// no installers and the dialog says so, unless
// ZVID_REQUIRE_CAPTURE_INSTALLERS=1, as in the deploy workflow, makes that an
// error. A run without desktop app installers, like those from before the
// desktop app had its own, only offers the plugin. Downloads are cached in node_modules/.cache by artifact id, so
// rebuilds under `wrangler dev` don't fetch them again.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  artifactPlatform,
  CAPTURE_INSTALLERS_DIR,
  CAPTURE_INSTALLERS_MANIFEST,
  CAPTURE_PLATFORMS,
  type CaptureInstaller,
  type CaptureInstallersManifest,
  type CapturePlatform,
  desktopArtifactPlatform,
  isCaptureInstallerEntry,
  isDesktopInstallerEntry,
} from "../src/capture-installers.ts";
import { listZipEntries, readZipEntry } from "../src/zip.ts";

const WORKFLOW = "daw-bundle.yml";
const BRANCH = "main";
const appDir = path.resolve(import.meta.dirname, "..");
const outDir = path.join(appDir, "dist", CAPTURE_INSTALLERS_DIR);
const cacheDir = path.join(
  appDir,
  "node_modules",
  ".cache",
  "zvid-capture-installers",
);
const repository = process.env.GITHUB_REPOSITORY || "lsegal/zvid";
const required = process.env.ZVID_REQUIRE_CAPTURE_INSTALLERS === "1";

type WorkflowRun = { id: number; head_sha: string; html_url: string };
type Artifact = { id: number; name: string; expired: boolean };
// Picks the installer out of an artifact's bundle zip entries.
type IsInstallerEntry = (name: string, platform: CapturePlatform) => boolean;

// Cloudflare's per-file limit for Worker static assets.
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function log(message: string) {
  console.log(`[capture-installers] ${message}`);
}

function githubToken() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    return token;
  }
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

async function github(token: string, url: string) {
  const response = await fetch(
    url.startsWith("https://") ? url : `https://api.github.com${url}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`);
  }
  return response;
}

// The installer inside an artifact. Artifacts are zips of the workflow's own
// bundle zip, so the installer is two zips deep.
async function extractInstaller(
  artifactZip: Uint8Array,
  platform: CapturePlatform,
  isInstallerEntry: IsInstallerEntry,
) {
  const outer = listZipEntries(artifactZip);
  const bundleEntry = outer.find((entry) => entry.name.endsWith(".zip"));
  if (!bundleEntry) {
    throw new Error("the artifact holds no bundle zip");
  }
  const bundleZip = await readZipEntry(artifactZip, bundleEntry);
  const installerEntry = listZipEntries(bundleZip).find((entry) =>
    isInstallerEntry(entry.name, platform),
  );
  if (!installerEntry) {
    throw new Error(`${bundleEntry.name} holds no ${platform} installer`);
  }
  return {
    file: path.posix.basename(installerEntry.name),
    contents: await readZipEntry(bundleZip, installerEntry),
  };
}

async function fetchInstaller(
  token: string,
  artifact: Artifact,
  platform: CapturePlatform,
  isInstallerEntry: IsInstallerEntry,
) {
  const cached = path.join(cacheDir, String(artifact.id));
  const cachedInfo = path.join(cached, "installer.json");
  if (existsSync(cachedInfo)) {
    const { file } = JSON.parse(await readFile(cachedInfo, "utf8")) as {
      file: string;
    };
    log(`${artifact.name}: using cached ${file}`);
    return { file, contents: await readFile(path.join(cached, file)) };
  }

  log(`${artifact.name}: downloading`);
  const response = await github(
    token,
    `/repos/${repository}/actions/artifacts/${artifact.id}/zip`,
  );
  const installer = await extractInstaller(
    new Uint8Array(await response.arrayBuffer()),
    platform,
    isInstallerEntry,
  );
  await mkdir(cached, { recursive: true });
  await writeFile(path.join(cached, installer.file), installer.contents);
  await writeFile(cachedInfo, JSON.stringify({ file: installer.file }));
  return installer;
}

async function main() {
  if (!existsSync(path.join(appDir, "dist"))) {
    throw new Error("dist is missing; run `pnpm run build` first");
  }

  const token = githubToken();
  if (!token) {
    throw new Error(
      "no GitHub token: set GH_TOKEN or GITHUB_TOKEN, or sign in with `gh auth login`",
    );
  }

  const runs = (await (
    await github(
      token,
      `/repos/${repository}/actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&status=success&per_page=1`,
    )
  ).json()) as { workflow_runs: WorkflowRun[] };
  const run = runs.workflow_runs[0];
  if (!run) {
    throw new Error(`no successful ${WORKFLOW} run on ${BRANCH}`);
  }
  log(`using ${run.html_url} (${run.head_sha.slice(0, 7)})`);

  const { artifacts } = (await (
    await github(
      token,
      `/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
    )
  ).json()) as { artifacts: Artifact[] };

  const available = artifacts.filter((artifact) => !artifact.expired);
  await mkdir(outDir, { recursive: true });

  // Writes an installer into dist/downloads and describes it.
  async function publish(file: string, contents: Uint8Array) {
    // `+` means a space in some URL decoders, so it stays out of the URL.
    const served = file.replaceAll("+", "-");
    await writeFile(path.join(outDir, served), contents);
    log(`${CAPTURE_INSTALLERS_DIR}/${served}`);
    return { file: served, size: contents.byteLength };
  }

  const installers: CaptureInstaller[] = [];
  let version = "";
  for (const platform of CAPTURE_PLATFORMS) {
    const artifact = available.find(
      (candidate) => artifactPlatform(candidate.name) === platform,
    );
    if (!artifact) {
      throw new Error(`run ${run.id} has no ${platform} artifact`);
    }
    const { file, contents } = await fetchInstaller(
      token,
      artifact,
      platform,
      isCaptureInstallerEntry,
    );
    // `zvid-capture-0.1.0+bba0984.pkg` -> `0.1.0+bba0984`.
    version ||=
      /^zvid-capture-(.+?)(?:-setup)?\.(?:pkg|exe)$/.exec(file)?.[1] ?? "";
    installers.push({ platform, ...(await publish(file, contents)) });
  }

  const desktop: CaptureInstaller[] = [];
  for (const platform of CAPTURE_PLATFORMS) {
    const artifact = available.find(
      (candidate) => desktopArtifactPlatform(candidate.name) === platform,
    );
    if (!artifact) {
      log(`run ${run.id} has no ${platform} desktop app artifact`);
      continue;
    }
    const { file, contents } = await fetchInstaller(
      token,
      artifact,
      platform,
      isDesktopInstallerEntry,
    );
    if (contents.byteLength > MAX_ASSET_BYTES) {
      console.warn(
        `[capture-installers] warning: ${file} is ${contents.byteLength} bytes, over the 25 MiB Worker asset limit; leaving it out`,
      );
      continue;
    }
    desktop.push({ platform, ...(await publish(file, contents)) });
  }

  const manifest: CaptureInstallersManifest = {
    version,
    commit: run.head_sha,
    runUrl: run.html_url,
    installers,
    desktop,
  };
  await writeFile(
    path.join(outDir, CAPTURE_INSTALLERS_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (required) {
    console.error(`[capture-installers] ${message}`);
    process.exitCode = 1;
  } else {
    log(`skipped: ${message}`);
  }
}
