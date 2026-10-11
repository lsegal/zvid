import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { usePhone } from "../../component-test/viewport.ts";
import { MobileShellChrome } from "./MobileShellChrome";
import { PhoneEditor } from "./phone-editor.fixture.tsx";
import {
  emulateReducedMotion,
  holdSheetExit,
  type MotionLog,
  recordMotion,
} from "./sheet-motion.fixture.ts";

// On a phone, the FX and Media sheets slide up as they open and back down
// as they close (#1211). The menu sheets' motion is in MenuSheet's tests.

let motion: MotionLog | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  motion?.stop();
  motion = null;
  await emulateReducedMotion(false);
  localStorage.clear();
});

const fxPanel = () => document.querySelector(".fx-panel") as HTMLElement;
const isShown = (element: Element | null) =>
  element !== null && getComputedStyle(element).display !== "none";
const editorTab = (name: string) =>
  page
    .getByRole("navigation", { name: "Editor" })
    .getByRole("button", { name });

describe(MobileShellChrome.name, () => {
  test("the FX sheet slides up, eases between heights and slides down", async () => {
    await usePhone();
    await render(<PhoneEditor />);
    motion = recordMotion();
    const log = motion;
    await editorTab("FX").click();
    await expect.poll(() => isShown(fxPanel())).toBe(true);
    await expect.poll(() => log.motion).toContain("fx-panel:mobile-sheet-in");

    await page.getByRole("button", { name: "Full height" }).click();
    await expect.poll(() => log.motion).toContain("fx-panel:height");

    const release = holdSheetExit();
    await page.getByRole("button", { name: "Close FX" }).click();
    await expect.poll(() => log.motion).toContain("fx-panel:mobile-sheet-out");
    release();
    await expect.poll(() => isShown(fxPanel())).toBe(false);
  });

  test("the Media sheet and its header slide up together and back down", async () => {
    await usePhone();
    await render(<PhoneEditor />);
    motion = recordMotion();
    const log = motion;
    await editorTab("Media").click();
    await expect
      .element(page.getByRole("button", { name: "Camera roll" }))
      .toBeVisible();
    await expect
      .poll(() => log.motion)
      .toEqual(
        expect.arrayContaining([
          "mobile-media-header:mobile-sheet-in-screen",
          "media-drawer:transform",
        ]),
      );

    const release = holdSheetExit();
    await page.getByRole("button", { name: "Close media" }).click();
    await expect
      .element(page.getByRole("button", { name: "Camera roll" }))
      .not.toBeInTheDocument();
    await expect
      .poll(() => log.motion)
      .toContain("mobile-media-header:mobile-sheet-out-screen");
    release();
    await expect
      .poll(() => document.querySelector(".mobile-media-header"))
      .toBeNull();
  });

  // The menu sheet's half of this is in MenuSheet's tests.
  test("with reduced motion, the FX sheet neither slides nor eases", async () => {
    await emulateReducedMotion();
    await usePhone();
    await render(<PhoneEditor />);
    motion = recordMotion();
    const log = motion;
    await editorTab("FX").click();
    await expect.poll(() => isShown(fxPanel())).toBe(true);
    await page.getByRole("button", { name: "Full height" }).click();
    await page.getByRole("button", { name: "Close FX" }).click();
    await expect.poll(() => isShown(fxPanel())).toBe(false);

    expect(log.motion).toContain("fx-panel:mobile-sheet-fade-in");
    expect(
      log.motion.filter((name) => /sheet-(in|out)\b|:height$/.test(name)),
    ).toEqual([]);
    expect(log.levelSlides).toEqual([]);
  });
});
