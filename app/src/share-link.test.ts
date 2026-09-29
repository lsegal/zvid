import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  copyShareLink,
  SHARE_LINK_COPIED_RESET_MS,
  SHARE_LINK_ICON_COPIED_RESET_MS,
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
    assert.equal(shareLinkButtonLabel("idle"), "Copy share link");
    assert.equal(shareLinkButtonLabel("copied"), "Copied ✓");
    assert.equal(shareLinkButtonLabel("failed"), "Copy failed");
    assert.equal(SHARE_LINK_COPIED_RESET_MS, 2000);
    assert.equal(SHARE_LINK_ICON_COPIED_RESET_MS, 1500);
  });

  it("points a failed copy at share start to the button, as an error", () => {
    const status = shareCopyFailedStatus(new Error("Write permission denied."));
    assert.match(status, /copying the invite failed: Write permission denied/);
    assert.match(status, /Use Copy share link in the status bar/);
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
    const button = functionBody(buttonTsx, "export function ShareLinkButton(");
    assert.match(button, /aria-label="Copy share link"/);
    assert.match(button, /title=\{url\}/);
    assert.match(button, /type="button"/);
  });
});

describe("share link icon next to Stop Share", () => {
  const iconButton = functionBody(
    buttonTsx,
    "export function ShareLinkIconButton(",
  );

  it("shows right after Stop Share only while the link is visible", () => {
    const stopShare = appTsx.indexOf('? "Stop Share"');
    const icon = appTsx.indexOf("<ShareLinkIconButton");
    const badge = appTsx.indexOf('className="share-copy-badge"');
    assert.ok(stopShare !== -1 && stopShare < icon, "after Stop Share");
    assert.ok(icon < badge, "before the Copied badge");
    assert.match(
      appTsx.slice(icon - 120, icon),
      /shareLinkVisible\(collaborationMode, shareUrl\) \? \(\s*$/,
    );
  });

  it("copies the share URL and shows the Copied badge on success", () => {
    assert.match(
      appTsx,
      /<ShareLinkIconButton\s+key=\{shareUrl\}\s+onCopied=\{showShareCopiedBadge\}\s+url=\{shareUrl\}/,
    );
    assert.match(
      functionBody(appTsx, "function showShareCopiedBadge()"),
      /setHasCopiedShareInvite\(true\)/,
    );
    assert.match(
      iconButton,
      /useShareLinkCopy\(url, SHARE_LINK_ICON_COPIED_RESET_MS, onCopied\)/,
    );
    assert.match(
      functionBody(buttonTsx, "function useShareLinkCopy("),
      /await copyShareLink\(url\)/,
    );
  });

  it("swaps to a check after copying", () => {
    assert.match(iconButton, /copyState === "copied" \? CheckIcon : LinkIcon/);
  });

  it("opens the manual-copy fallback when copying fails", () => {
    assert.match(
      iconButton,
      /copyState === "failed"[\s\S]*<ShareLinkFallback[\s\S]*url=\{url\}/,
    );
  });

  it("is an icon-only, keyboard reachable button with a tooltip", () => {
    assert.match(iconButton, /aria-label="Copy share link"/);
    assert.match(iconButton, /title="Copy share link"/);
    assert.match(iconButton, /type="button"/);
    assert.match(iconButton, /<button[\s\S]*<Icon aria-hidden="true"/);
  });
});
