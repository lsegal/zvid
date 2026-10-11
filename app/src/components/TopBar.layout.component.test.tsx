import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { setViewport } from "../component-test/viewport.ts";
import { TopBarHarness } from "./top-bar-test-harness.tsx";
import "./TopBar";

// The desktop top bar's layout.
//
// It is a compact menu bar (#1207): the File / Edit / Help row sets its
// height, and Export, the connection status, Share, the copy link icon and
// the Copied badge shrink to fit it, centered vertically. A browser tab
// gives the row 2px more room above and below (#1220) than the installed
// app does.
//
// It keeps its left group (brand mark and menubar) and its right group
// (Export, connection status, Share) on one row whenever they fit side by
// side, and wraps the right group below only when they would touch (#1216).

afterEach(() => {
  document.documentElement.classList.remove("installed-app");
  vi.restoreAllMocks();
});

function element(selector: string) {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`${selector} is not rendered`);
  return found;
}

function box(target: string | Element) {
  return (
    typeof target === "string" ? element(target) : target
  ).getBoundingClientRect();
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function resize(width: number, height: number) {
  await setViewport({ width, height });
  await nextFrame();
  expect(window.innerWidth).toBe(width);
}

function button(name: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(".topbar button"),
  ].find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`no ${name} button`);
  return found;
}

function expectFitsTopBar(controls: Element[]) {
  const bar = box(".topbar");
  const menuItem = box('.topbar [role="menubar"] .menubar-item');
  const barCenter = bar.y + bar.height / 2;
  for (const control of controls) {
    const { y, height } = box(control);
    expect(y).toBeGreaterThanOrEqual(bar.y);
    expect(y + height).toBeLessThanOrEqual(bar.y + bar.height);
    expect(Math.abs(y + height / 2 - barCenter)).toBeLessThanOrEqual(1);
    // No taller than a few pixels over a menubar item, so it doesn't set
    // the bar's height.
    expect(height).toBeLessThanOrEqual(menuItem.height + 4);
  }
}

// Hosts a share and copies its link with the icon beside Stop Share, as
// after Share > Start Sharing.
async function renderSharingWithLinkCopied() {
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const screen = await render(<TopBarHarness sharing />);
  await expect
    .element(screen.getByRole("button", { name: "Stop Share" }))
    .toBeVisible();
  const icon = element(".share-link-icon-button");
  await userEvent.click(icon);
  await expect.element(page.elementLocator(icon)).toBeVisible();
  await expect
    .poll(() => document.querySelector(".share-copy-badge"))
    .not.toBeNull();
  return { icon, badge: element(".share-copy-badge") };
}

function layout() {
  return {
    bar: box(".topbar"),
    left: box(".topbar__group"),
    right: box(".topbar__group--right"),
    padding: Number.parseFloat(
      getComputedStyle(element(".topbar")).paddingRight,
    ),
  };
}

// Both groups share a row, and the right group sits at the bar's right edge.
function expectOneRow() {
  const { bar, left, right, padding } = layout();
  expect(
    Math.abs(right.y + right.height / 2 - (left.y + left.height / 2)),
  ).toBeLessThan(2);
  expect(right.x).toBeGreaterThan(left.x + left.width);
  expect(bar.x + bar.width - (right.x + right.width)).toBeCloseTo(padding, 0);
  // No taller than one row of content plus the bar's padding.
  expect(bar.height - Math.max(left.height, right.height)).toBeLessThanOrEqual(
    20,
  );
}

describe("TopBar compact height", () => {
  test("is about as tall as its menubar items", async () => {
    await resize(1440, 900);
    const screen = await render(<TopBarHarness />);
    await expect.element(screen.getByRole("menubar")).toBeVisible();
    const menuItem = box(
      screen.getByRole("menuitem", { name: "File" }).element(),
    );
    const bar = box(".topbar");
    expect(bar.height).toBeLessThanOrEqual(40);
    expect(bar.height - menuItem.height).toBeLessThanOrEqual(16);
    // The buttons stay comfortable click targets.
    for (const name of ["Export", "Share"]) {
      expect(box(button(name)).height).toBeGreaterThanOrEqual(24);
    }

    expectFitsTopBar([
      button("Export"),
      element(".topbar__group--right .collaboration-status"),
      button("Share"),
    ]);
  });

  test("fits the share link icon and Copied badge", async () => {
    await resize(1440, 900);
    const { icon, badge } = await renderSharingWithLinkCopied();
    expectFitsTopBar([button("Stop Share"), icon, badge]);
    expect(box(".topbar").height).toBeLessThanOrEqual(40);
  });

  // main.tsx marks an iOS home screen app's root, which hides the brand
  // mark.
  test("is just as compact in the installed app, without the logo", async () => {
    await resize(1440, 900);
    document.documentElement.classList.add("installed-app");
    const screen = await render(<TopBarHarness />);
    await expect.element(screen.getByRole("menubar")).toBeVisible();
    expect(getComputedStyle(element(".topbar .brand-mark")).display).toBe(
      "none",
    );
    expect(box(".topbar").height).toBeLessThanOrEqual(36);
    expectFitsTopBar([button("Export"), button("Share")]);
  });
});

describe("TopBar wrapping", () => {
  for (const width of [1100, 1240, 1440]) {
    test(`stays on one row at ${width}px`, async () => {
      await resize(width, 800);
      const screen = await render(<TopBarHarness />);
      await expect.element(screen.getByRole("menubar")).toBeVisible();
      expectOneRow();
    });
  }

  test("stays on one row at 1100px while sharing", async () => {
    await resize(1100, 800);
    await renderSharingWithLinkCopied();
    expectOneRow();
  });

  test("wraps the right group below, right-aligned, only once the groups touch", async () => {
    await resize(1100, 800);
    const screen = await render(<TopBarHarness />);
    await expect.element(screen.getByRole("menubar")).toBeVisible();
    const { bar, left, right } = layout();
    // The narrowest window that still fits both groups: the 16px gap
    // between them, the bar's padding (14px per side at these widths,
    // ≤ 900px) and whatever of the window lies outside the bar.
    const outside = 1100 - bar.width;
    const fits = Math.ceil(left.width + right.width + 16 + 28 + outside);
    expect(fits).toBeLessThan(880);

    await resize(fits + 2, 800);
    expectOneRow();

    await resize(fits - 20, 800);
    const wrapped = layout();
    expect(wrapped.right.y).toBeGreaterThanOrEqual(
      wrapped.left.y + wrapped.left.height,
    );
    expect(
      wrapped.bar.x +
        wrapped.bar.width -
        (wrapped.right.x + wrapped.right.width),
    ).toBeCloseTo(wrapped.padding, 0);
    expect(wrapped.left.x - wrapped.bar.x).toBeCloseTo(wrapped.padding, 0);
  });
});
