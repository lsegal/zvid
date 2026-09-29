import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  copyShareLink,
  SHARE_LINK_COPIED_RESET_MS,
  shareCopyFailedStatus,
  shareLinkButtonLabel,
  shareLinkVisible,
} from "./share-link.ts";
import { statusMessageTone } from "./status-bar.ts";

const appTsx = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const buttonTsx = readFileSync(
  new URL("./components/ShareLinkButton.tsx", import.meta.url),
  "utf8",
);

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  return source.slice(start, source.indexOf("\n  }\n", start));
}

describe("share link visibility", () => {
  it("shows only while sharing with a built URL", () => {
    assert.equal(
      shareLinkVisible("sharing", "https://zvid.test/?room=a"),
      true,
    );
  });

  it("hides while the link is still being built", () => {
    assert.equal(shareLinkVisible("sharing", ""), false);
  });

  it("hides when not hosting a share", () => {
    assert.equal(shareLinkVisible("idle", "https://zvid.test/?room=a"), false);
    assert.equal(
      shareLinkVisible("connected", "https://zvid.test/?room=a"),
      false,
    );
  });
});

describe("copying the share link", () => {
  it("writes the URL to the clipboard", async () => {
    const written: string[] = [];
    const state = await copyShareLink("https://zvid.test/?room=a", {
      writeText: async (text) => {
        written.push(text);
      },
    });
    assert.equal(state, "copied");
    assert.deepEqual(written, ["https://zvid.test/?room=a"]);
  });

  it("reports a clipboard error as failed", async () => {
    const state = await copyShareLink("https://zvid.test/?room=a", {
      writeText: async () => {
        throw new Error("Document is not focused.");
      },
    });
    assert.equal(state, "failed");
  });

  it("reports a missing clipboard as failed", async () => {
    assert.equal(
      await copyShareLink("https://zvid.test/?room=a", undefined),
      "failed",
    );
  });

  it("labels each state", () => {
    assert.equal(shareLinkButtonLabel("idle"), "Copy link");
    assert.equal(shareLinkButtonLabel("copied"), "Copied ✓");
    assert.equal(shareLinkButtonLabel("failed"), "Copy failed");
    assert.equal(SHARE_LINK_COPIED_RESET_MS, 2000);
  });

  it("points a failed copy at share start to the button, as an error", () => {
    const status = shareCopyFailedStatus(new Error("Write permission denied."));
    assert.match(status, /copying the invite failed: Write permission denied/);
    assert.match(status, /Copy link in the status bar/);
    assert.equal(statusMessageTone(status), "error");
  });
});

describe("share link wiring", () => {
  it("keeps the URL even when the automatic copy fails", () => {
    const start = functionBody(appTsx, "async function handleStartShare()");
    assert.ok(
      start.indexOf("setShareUrl(inviteUrl)") <
        start.indexOf("navigator.clipboard.writeText(inviteUrl)"),
      "the URL is stored before the clipboard write",
    );
    assert.match(start, /setStatus\(shareCopyFailedStatus\(error\)\)/);
  });

  it("clears the URL on Stop Share", () => {
    assert.match(
      functionBody(appTsx, "function handleStopShare()"),
      /setShareUrl\(""\)/,
    );
  });

  it("adds the button to the status bar while the link is visible", () => {
    assert.match(appTsx, /shareLinkVisible\(collaborationMode, shareUrl\)/);
    assert.match(
      appTsx,
      /<ShareLinkButton key=\{shareUrl\} url=\{shareUrl\} \/>/,
    );
  });

  it("is keyboard reachable with an accessible name and URL tooltip", () => {
    assert.match(buttonTsx, /aria-label="Copy share link"/);
    assert.match(buttonTsx, /title=\{url\}/);
    assert.match(buttonTsx, /type="button"/);
  });
});
