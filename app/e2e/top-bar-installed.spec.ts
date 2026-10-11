import { expect, type Page, test } from "@playwright/test";

// The desktop top bar is compact, and drops its brand mark when zvid runs as
// an installed app, whose title bar already shows the zvid icon and name
// (#1200).

function topbar(page: Page) {
  return page.locator(".topbar");
}

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`${selector} has no box`);
  return found;
}

// The vertical centers of the menubar and the right-hand controls agree.
async function expectControlsCentered(page: Page) {
  const centers = await Promise.all(
    [
      ".topbar__menubar",
      ".topbar__group--right .collaboration-status",
      ".topbar__group--right button",
    ].map(async (selector) => {
      const { y, height } = await box(page, selector);
      return y + height / 2;
    }),
  );
  for (const center of centers) {
    expect(Math.abs(center - centers[0])).toBeLessThan(2);
  }
}

// Reports the page as an iOS home screen app.
async function emulateIosStandalone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", {
      configurable: true,
      get: () => true,
    });
  });
}

// The display modes whose @media rules hide the top bar's brand mark.
// Chromium can't emulate display-mode (CDP ignores it), so this reads the
// rules from the page's style sheets.
async function hidingDisplayModes(page: Page) {
  return page.evaluate(() => {
    const modes = new Set<string>();
    const rules = (sheet: CSSStyleSheet) => {
      try {
        return Array.from(sheet.cssRules);
      } catch {
        return [];
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of rules(sheet)) {
        if (!(rule instanceof CSSMediaRule)) continue;
        const hides = Array.from(rule.cssRules).some(
          (inner) =>
            inner instanceof CSSStyleRule &&
            inner.selectorText === ".topbar button.brand-mark" &&
            inner.style.display === "none",
        );
        if (!hides) continue;
        for (const match of rule.media.mediaText.matchAll(
          /\(display-mode: ([a-z-]+)\)/g,
        )) {
          modes.add(match[1]);
        }
      }
    }
    return [...modes].sort();
  });
}

test("in a browser tab the top bar is compact and keeps its brand mark", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("menubar")).toBeVisible();
  await expect(topbar(page).locator(".brand-mark")).toBeVisible();

  // At most 20 px of padding above and below the tallest group (was 28).
  const bar = await box(page, ".topbar");
  const groups = await Promise.all([
    box(page, ".topbar__group"),
    box(page, ".topbar__group--right"),
  ]);
  const content = Math.max(...groups.map((group) => group.height));
  expect(bar.height - content).toBeLessThanOrEqual(20);
  await expectControlsCentered(page);
});

test("installed display modes hide the brand mark from the first paint", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("menubar")).toBeVisible();
  // Not fullscreen: a browser tab in fullscreen matches it too.
  expect(await hidingDisplayModes(page)).toEqual([
    "minimal-ui",
    "standalone",
    "window-controls-overlay",
  ]);
});

test("an iOS home screen app hides the brand mark and moves the menubar left", async ({
  page,
}) => {
  await emulateIosStandalone(page);
  await page.goto("/");
  await expect(page.getByRole("menubar")).toBeVisible();
  await expect(topbar(page).locator(".brand-mark")).toBeHidden();

  const bar = await box(page, ".topbar");
  const menubar = await box(page, ".topbar__menubar");
  expect(menubar.x - bar.x).toBeCloseTo(24, 0);
  await expectControlsCentered(page);

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
});
