import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ShareLinkButton, ShareLinkIconButton } from "./ShareLinkButton";

// The Copy share link buttons during a live share: the status bar button and
// the green link icon next to Stop Share. Either copies the invite at any
// time, and offers it for manual copy when the clipboard fails.

const INVITE = "https://zvid.example/?room=demo#password=s3cret";

// Replaces the clipboard: writeText records what it was given, or rejects
// when `fails` is set.
function stubClipboard({ fails = false } = {}) {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(text: string) {
        if (fails) return Promise.reject(new Error("Clipboard blocked"));
        writes.push(text);
        return Promise.resolve();
      },
    },
  });
  return writes;
}

afterEach(() => {
  // Back to the browser's own clipboard on Navigator.prototype.
  delete (navigator as { clipboard?: unknown }).clipboard;
});

function fallback() {
  return page.getByRole("dialog", { name: "Share link" });
}

describe("ShareLinkButton", () => {
  test("copies the invite, confirms, and is keyboard reachable", async () => {
    const writes = stubClipboard();
    await render(<ShareLinkButton url={INVITE} />);
    const button = page.getByRole("button", { name: "Copy share link" });
    await expect.element(button).toHaveAttribute("title", INVITE);
    await expect.element(button).toHaveTextContent("Copy share link");

    await button.click();
    await expect.element(button).toHaveTextContent("Copied ✓");
    expect(writes).toEqual([INVITE]);
    await expect
      .element(button, { timeout: 5_000 })
      .toHaveTextContent("Copy share link");

    (button.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(button).toHaveTextContent("Copied ✓");
    expect(writes).toEqual([INVITE, INVITE]);
  });

  test("offers the link above it for manual copy when the clipboard fails", async () => {
    stubClipboard({ fails: true });
    // At the bottom of the window, like the status bar.
    await render(
      <div style={{ position: "fixed", bottom: 0, left: 40 }}>
        <ShareLinkButton url={INVITE} />
      </div>,
    );
    const button = page.getByRole("button", { name: "Copy share link" });
    await button.click();
    await expect.element(button).toHaveTextContent("Copy failed");

    const input = fallback().getByRole("textbox");
    await expect.element(input).toHaveValue(INVITE);
    await expect.element(input).toHaveFocus();
    const popover = fallback().element().getBoundingClientRect();
    const anchor = button.element().getBoundingClientRect();
    expect(popover.bottom).toBeLessThanOrEqual(anchor.top);
    expect(popover.height).toBeGreaterThan(0);

    await userEvent.keyboard("{Escape}");
    await expect.element(fallback()).not.toBeInTheDocument();
    await expect.element(button).toHaveTextContent("Copy share link");
    await expect.element(button).toHaveFocus();
  });
});

describe("ShareLinkIconButton", () => {
  test("copies the invite, shows a check for a moment, and is keyboard reachable", async () => {
    const writes = stubClipboard();
    let copied = 0;
    await render(
      <ShareLinkIconButton onCopied={() => (copied += 1)} url={INVITE} />,
    );
    const icon = page.getByRole("button", { name: "Copy share link" });
    await expect.element(icon).toHaveAttribute("title", "Copy share link");
    await expect.element(icon).toHaveClass("share-link-icon-button--idle");

    await icon.click();
    await expect.element(icon).toHaveClass("share-link-icon-button--copied");
    expect(writes).toEqual([INVITE]);
    expect(copied).toBe(1);
    await expect
      .element(icon, { timeout: 5_000 })
      .toHaveClass("share-link-icon-button--idle");

    (icon.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(icon).toHaveClass("share-link-icon-button--copied");
    expect(copied).toBe(2);
  });

  test("offers the link below it for manual copy when the clipboard fails", async () => {
    stubClipboard({ fails: true });
    let copied = 0;
    // At the top right of the window, like the top bar.
    await render(
      <div style={{ position: "fixed", top: 0, right: 40 }}>
        <ShareLinkIconButton onCopied={() => (copied += 1)} url={INVITE} />
      </div>,
    );
    const icon = page.getByRole("button", { name: "Copy share link" });
    await icon.click();
    await expect.element(icon).toHaveClass("share-link-icon-button--failed");
    expect(copied).toBe(0);

    const input = fallback().getByRole("textbox");
    await expect.element(input).toHaveValue(INVITE);
    await expect.element(input).toHaveFocus();
    const popover = fallback().element().getBoundingClientRect();
    const anchor = icon.element().getBoundingClientRect();
    expect(popover.top).toBeGreaterThanOrEqual(anchor.bottom);
    expect(popover.left).toBeGreaterThanOrEqual(0);

    await userEvent.keyboard("{Escape}");
    await expect.element(fallback()).not.toBeInTheDocument();
    await expect.element(icon).toHaveClass("share-link-icon-button--idle");
    await expect.element(icon).toHaveFocus();
  });
});
