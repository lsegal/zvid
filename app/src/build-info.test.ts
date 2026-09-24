import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAppVersion,
  formatBuildLabel,
  formatBuildTime,
  type GitRunner,
  getCommitUrl,
  resolveAppCommit,
  shortCommit,
} from "./build-info.ts";

const SHA = "c94f40e9151d40b4dd87bd2072993522791ff2d4";
const OTHER_SHA = "777f18d0000000000000000000000000000000aa";

function fakeGit(outputs: Record<string, string | Error>): GitRunner {
  return (args) => {
    const output = outputs[args.join(" ")];
    if (output === undefined || output instanceof Error) {
      throw output ?? new Error(`unexpected git ${args.join(" ")}`);
    }
    return output;
  };
}

const noGit: GitRunner = () => {
  throw new Error("git is not available");
};

describe("resolveAppCommit", () => {
  it("prefers GITHUB_SHA over the other CI variables and git", () => {
    const env = {
      GITHUB_SHA: SHA,
      CF_PAGES_COMMIT_SHA: OTHER_SHA,
      WORKERS_CI_COMMIT_SHA: OTHER_SHA,
    };
    assert.equal(resolveAppCommit(env, noGit), SHA);
  });

  it("falls back to the Cloudflare CI variables in order", () => {
    assert.equal(
      resolveAppCommit(
        { CF_PAGES_COMMIT_SHA: SHA, WORKERS_CI_COMMIT_SHA: OTHER_SHA },
        noGit,
      ),
      SHA,
    );
    assert.equal(resolveAppCommit({ WORKERS_CI_COMMIT_SHA: SHA }, noGit), SHA);
  });

  it("ignores blank variables", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${SHA}\n`,
      "status --porcelain": "",
    });
    assert.equal(resolveAppCommit({ GITHUB_SHA: "  " }, git), SHA);
  });

  it("uses the local HEAD for a clean checkout", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${SHA}\n`,
      "status --porcelain": "",
    });
    assert.equal(resolveAppCommit({}, git), SHA);
  });

  it("marks a checkout with uncommitted changes as dirty", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${SHA}\n`,
      "status --porcelain": " M app/src/App.tsx\n",
    });
    assert.equal(resolveAppCommit({}, git), `${SHA}-dirty`);
  });

  it("does not mark CI builds dirty", () => {
    const git = fakeGit({ "status --porcelain": " M app/src/App.tsx\n" });
    assert.equal(resolveAppCommit({ GITHUB_SHA: SHA }, git), SHA);
  });

  it("is dev outside a git checkout", () => {
    assert.equal(resolveAppCommit({}, noGit), "dev");
  });
});

describe("shortCommit", () => {
  it("shortens a full SHA to seven characters", () => {
    assert.equal(shortCommit(SHA), "c94f40e");
  });

  it("keeps the dirty marker", () => {
    assert.equal(shortCommit(`${SHA}-dirty`), "c94f40e-dirty");
  });

  it("leaves non-SHA values alone", () => {
    assert.equal(shortCommit("dev"), "dev");
  });
});

describe("formatAppVersion", () => {
  it("appends the short SHA as build metadata", () => {
    assert.equal(formatAppVersion("0.0.0", SHA), "0.0.0+c94f40e");
  });

  it("keeps the dirty marker", () => {
    assert.equal(
      formatAppVersion("1.2.3", `${SHA}-dirty`),
      "1.2.3+c94f40e-dirty",
    );
  });

  it("is the bare version without a commit", () => {
    assert.equal(formatAppVersion("0.0.0", "dev"), "0.0.0");
  });
});

describe("getCommitUrl", () => {
  it("links to the commit on GitHub", () => {
    assert.equal(
      getCommitUrl(SHA),
      `https://github.com/lsegal/zvid/commit/${SHA}`,
    );
  });

  it("links a dirty build to its base commit", () => {
    assert.equal(
      getCommitUrl(`${SHA}-dirty`),
      `https://github.com/lsegal/zvid/commit/${SHA}`,
    );
  });

  it("has no link without a commit", () => {
    assert.equal(getCommitUrl("dev"), null);
  });
});

describe("formatBuildTime", () => {
  it("formats an ISO time as UTC minutes", () => {
    assert.equal(
      formatBuildTime("2026-09-24T14:45:12.345Z"),
      "2026-09-24 14:45 UTC",
    );
  });

  it("leaves an unparseable time alone", () => {
    assert.equal(formatBuildTime("unknown"), "unknown");
  });
});

describe("formatBuildLabel", () => {
  it("combines the short SHA and build time", () => {
    assert.equal(
      formatBuildLabel(SHA, "2026-09-24T14:45:12.345Z"),
      "zvid · c94f40e · built 2026-09-24 14:45 UTC",
    );
  });
});
