import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { usePhone } from "../../component-test/viewport.ts";
import type { ContextMenuEntry } from "../../context-menu.ts";
import { MenuSheet } from "./MenuSheet";
import {
  emulateReducedMotion,
  holdSheetExit,
  type MotionLog,
  recordMotion,
} from "./sheet-motion.fixture.ts";

// On a phone, a menu sheet slides up as it opens and back down as it
// closes, and its submenus slide in from the right (#1211).

const noop = () => {};

// A More menu like the top bar's: File > Open > its items.
const entries: ContextMenuEntry[] = [
  {
    type: "item",
    id: "file",
    label: "File",
    submenu: [
      {
        type: "item",
        id: "open",
        label: "Open",
        submenu: [
          {
            type: "item",
            id: "open-project",
            label: "Project…",
            onSelect: noop,
          },
          { type: "item", id: "open-folder", label: "Folder…", onSelect: noop },
        ],
      },
      { type: "item", id: "save", label: "Save", onSelect: noop },
    ],
  },
  { type: "separator" },
  { type: "item", id: "reorder", label: "Reorder Layers", onSelect: noop },
];

function MoreMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-label="More" onClick={() => setOpen(true)} type="button">
        …
      </button>
      <MenuSheet
        entries={open ? entries : []}
        label="More"
        onClose={() => setOpen(false)}
        open={open}
      />
    </>
  );
}

const sheet = () => document.querySelector(".mobile-menu-sheet");

let motion: MotionLog | null = null;

afterEach(async () => {
  vi.useRealTimers();
  motion?.stop();
  motion = null;
  await emulateReducedMotion(false);
});

async function openMore() {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect.poll(sheet).not.toBeNull();
}

function backText() {
  return document.querySelector(".mobile-menu-sheet__back")?.textContent;
}

describe("MenuSheet", () => {
  test("slides up over a fading backdrop and back down", async () => {
    await usePhone();
    await render(<MoreMenu />);
    motion = recordMotion();
    const log = motion;
    await openMore();
    await expect
      .element(page.getByRole("menu", { name: "More" }))
      .toBeVisible();
    await expect
      .poll(() => log.motion)
      .toEqual(
        expect.arrayContaining([
          "mobile-sheet-backdrop:mobile-sheet-fade-in",
          "mobile-sheet:mobile-sheet-in",
        ]),
      );

    const release = holdSheetExit();
    await page.getByRole("button", { name: "Close menu" }).click();
    // It stays up, out of the way of taps and the accessibility tree, until
    // it has slid away.
    await expect
      .element(page.getByRole("menu", { name: "More" }))
      .not.toBeInTheDocument();
    await expect
      .poll(() => log.motion)
      .toEqual(
        expect.arrayContaining([
          "mobile-sheet-backdrop:mobile-sheet-fade-out",
          "mobile-sheet:mobile-sheet-out",
        ]),
      );
    release();
    await expect.poll(sheet).toBeNull();
  });

  test("slides a submenu in from the right, and Back slides it out", async () => {
    await usePhone();
    await render(<MoreMenu />);
    await openMore();
    motion = recordMotion();
    const log = motion;
    await page.getByRole("menuitem", { name: "File" }).click();
    await expect.poll(backText).toBe("File");
    await expect.poll(() => log.levelSlides.length).toBe(1);
    const [forward] = log.levelSlides;
    expect(forward.nav).toBe("forward");
    expect(forward.animations).toEqual(
      expect.arrayContaining([
        "::view-transition-old(mobile-menu-level) mobile-menu-level-to-left",
        "::view-transition-new(mobile-menu-level) mobile-menu-level-from-right",
      ]),
    );
    // The sheet's outline eases to the new level's height.
    expect(
      forward.animations.some((name) =>
        name.startsWith("::view-transition-group(mobile-menu-sheet)"),
      ),
    ).toBe(true);
    // The rows are live at once: the next tap lands on the new level.
    await page.getByRole("menuitem", { name: "Open" }).click();
    await expect.poll(backText).toBe("Open");

    // On the Open level, its Back row is the one named Open.
    await page.getByRole("menuitem", { name: "Open", exact: true }).click();
    await expect.poll(backText).toBe("File");
    await expect.poll(() => log.levelSlides.length).toBe(3);
    const back = log.levelSlides[2];
    expect(back.nav).toBe("back");
    expect(back.animations).toEqual(
      expect.arrayContaining([
        "::view-transition-old(mobile-menu-level) mobile-menu-level-to-right",
        "::view-transition-new(mobile-menu-level) mobile-menu-level-from-left",
      ]),
    );
    await expect
      .poll(() => document.documentElement.dataset.menuSheetNav)
      .toBeUndefined();
  });

  // The FX sheet's half of this is in MobileShellChrome's tests.
  test("with reduced motion, neither the sheet nor a submenu slides", async () => {
    await emulateReducedMotion();
    await usePhone();
    await render(<MoreMenu />);
    motion = recordMotion();
    const log = motion;
    await openMore();
    await page.getByRole("menuitem", { name: "File" }).click();
    await expect.poll(backText).toBe("File");
    await userEvent.keyboard("{Escape}");
    await expect.poll(sheet).toBeNull();

    expect(log.motion).toContain("mobile-sheet:mobile-sheet-fade-in");
    expect(
      log.motion.filter((name) => /sheet-(in|out)\b|:height$/.test(name)),
    ).toEqual([]);
    expect(log.levelSlides).toEqual([]);
  });
});
