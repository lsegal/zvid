// Build identification: which version and commit a zvid build was made from
// and when. `resolveAppCommit` runs in vite.config.ts at build time; the
// formatting helpers run in the app against the injected __APP_VERSION__,
// __APP_COMMIT__ and __APP_BUILD_TIME__ globals.

export const REPOSITORY_URL = "https://github.com/lsegal/zvid";

const DIRTY_SUFFIX = "-dirty";
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

// Environment variables that carry the commit being built, in priority order.
const COMMIT_ENV_VARS = [
  "GITHUB_SHA",
  "CF_PAGES_COMMIT_SHA",
  "WORKERS_CI_COMMIT_SHA",
] as const;

// Runs a git command and returns its trimmed stdout, or throws.
export type GitRunner = (args: string[]) => string;

export function resolveAppCommit(
  env: Record<string, string | undefined>,
  git: GitRunner,
): string {
  for (const name of COMMIT_ENV_VARS) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }

  try {
    const head = git(["rev-parse", "HEAD"]).trim();
    if (!head) {
      return "dev";
    }
    let isDirty = false;
    try {
      isDirty = git(["status", "--porcelain"]).trim() !== "";
    } catch {
      // A clean HEAD is still more useful than no commit at all.
    }
    return isDirty ? `${head}${DIRTY_SUFFIX}` : head;
  } catch {
    return "dev";
  }
}

function stripDirty(commit: string) {
  return commit.endsWith(DIRTY_SUFFIX)
    ? commit.slice(0, -DIRTY_SUFFIX.length)
    : commit;
}

// `c94f40e9151d…` -> `c94f40e`, keeping any `-dirty` marker.
export function shortCommit(commit: string) {
  const sha = stripDirty(commit);
  if (!COMMIT_PATTERN.test(sha)) {
    return commit;
  }
  const short = sha.slice(0, 7);
  return sha === commit ? short : `${short}${DIRTY_SUFFIX}`;
}

// `0.0.0` + `c94f40e9151d…` -> `0.0.0+c94f40e`, keeping any `-dirty` marker.
// Builds without a real commit get the bare version.
export function formatAppVersion(version: string, commit: string) {
  return COMMIT_PATTERN.test(stripDirty(commit))
    ? `${version}+${shortCommit(commit)}`
    : version;
}

// The GitHub commit page, or null when the build has no real commit.
export function getCommitUrl(commit: string) {
  const sha = stripDirty(commit);
  return COMMIT_PATTERN.test(sha) ? `${REPOSITORY_URL}/commit/${sha}` : null;
}

// `2026-09-24T14:45:12.345Z` -> `2026-09-24 14:45 UTC`.
export function formatBuildTime(buildTime: string) {
  const date = new Date(buildTime);
  if (Number.isNaN(date.getTime())) {
    return buildTime;
  }
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// The version, commit and build time a zvid build was made from.
export type AppBuild = {
  version: string;
  commit: string;
  buildTime: string;
};

// Hover text with the full version, commit and build time, one per line:
// `zvid 0.0.0+c94f40e`, `Commit c94f40e9151d…`, `Built 2026-09-24 14:45 UTC`.
// Builds without a real commit leave the commit line out.
export function formatBuildTitle(build: AppBuild) {
  const lines = [`zvid ${formatAppVersion(build.version, build.commit)}`];
  if (COMMIT_PATTERN.test(stripDirty(build.commit))) {
    lines.push(`Commit ${build.commit}`);
  }
  lines.push(`Built ${formatBuildTime(build.buildTime)}`);
  return lines.join("\n");
}

// `zvid · c94f40e · built 2026-09-24 14:45 UTC`
export function formatBuildLabel(commit: string, buildTime: string) {
  return `zvid · ${shortCommit(commit)} · built ${formatBuildTime(buildTime)}`;
}
