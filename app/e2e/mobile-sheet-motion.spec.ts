import { devices, expect, type Page, test } from "@playwright/test";

// On a phone, sheets slide up as they open and back down as they close,
// and a menu sheet's submenus slide in from the right (#1211). The motion
// is over in a quarter second, so each test records the animations as they
// start rather than catching them mid-flight.
const { defaultBrowserType: _, ...PHONE } = devices["Pixel 7"];

test.use(PHONE);

type MotionWindow = Window & {
  motion: string[];
  levelSlides: { nav?: string; animations: string[] }[];
};

// Logs "<first class>:<animation or transitioned property>" for each CSS
// animation or transition that starts, and each submenu view transition's
// direction and pseudo-element animations.
async function recordMotion(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as MotionWindow;
    target.motion = [];
    target.levelSlides = [];
    const log = (element: EventTarget | null, name: string) => {
      const owner = element instanceof Element ? element.classList[0] : "";
      target.motion.push(`${owner}:${name}`);
    };
    document.addEventListener("animationstart", (event) =>
      log(event.target, event.animationName),
    );
    document.addEventListener("transitionrun", (event) =>
      log(event.target, event.propertyName),
    );
    const start = document.startViewTransition?.bind(document);
    if (!start) {
      return;
    }
    document.startViewTransition = ((update: ViewTransitionUpdateCallback) => {
      const transition = start(update);
      void transition.ready.then(() => {
        target.levelSlides.push({
          nav: document.documentElement.dataset.menuSheetNav,
          animations: document.getAnimations().map((animation) => {
            const effect = animation.effect as KeyframeEffect;
            const name = (animation as CSSAnimation).animationName;
            return `${effect.pseudoElement} ${name}`;
          }),
        });
      });
      return transition;
    }) as typeof document.startViewTransition;
  });
}

function motion(page: Page) {
  return page.evaluate(() => (window as unknown as MotionWindow).motion);
}

function levelSlides(page: Page) {
  return page.evaluate(() => (window as unknown as MotionWindow).levelSlides);
}

test("a menu sheet slides up over a fading backdrop and back down", async ({
  page,
}) => {
  await page.goto("/");
  await recordMotion(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  const sheet = page.locator(".mobile-menu-sheet");
  await expect(sheet).toBeVisible();
  await expect
    .poll(() => motion(page))
    .toEqual(
      expect.arrayContaining([
        "mobile-sheet-backdrop:mobile-sheet-fade-in",
        "mobile-sheet:mobile-sheet-in",
      ]),
    );

  await page.getByRole("button", { name: "Close menu" }).click();
  // It stays up, out of the way of taps and the accessibility tree, until
  // it has slid away.
  await expect(page.getByRole("menu", { name: "More" })).toHaveCount(0);
  await expect
    .poll(() => motion(page))
    .toEqual(
      expect.arrayContaining([
        "mobile-sheet-backdrop:mobile-sheet-fade-out",
        "mobile-sheet:mobile-sheet-out",
      ]),
    );
  await expect(sheet).toHaveCount(0);
});

test("a submenu slides in from the right, and Back slides it out", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "More", exact: true }).click();
  const sheet = page.locator(".mobile-menu-sheet");
  await recordMotion(page);
  await sheet.getByRole("menuitem", { name: "File" }).click();
  await expect(sheet.locator(".mobile-menu-sheet__back")).toHaveText("File");
  await expect.poll(async () => (await levelSlides(page)).length).toBe(1);
  const [forward] = await levelSlides(page);
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
  await sheet.getByRole("menuitem", { name: "Open" }).click();
  await expect(sheet.locator(".mobile-menu-sheet__back")).toHaveText("Open");

  await sheet.locator(".mobile-menu-sheet__back").click();
  await expect(sheet.locator(".mobile-menu-sheet__back")).toHaveText("File");
  await expect.poll(async () => (await levelSlides(page)).length).toBe(3);
  const back = (await levelSlides(page))[2];
  expect(back.nav).toBe("back");
  expect(back.animations).toEqual(
    expect.arrayContaining([
      "::view-transition-old(mobile-menu-level) mobile-menu-level-to-right",
      "::view-transition-new(mobile-menu-level) mobile-menu-level-from-left",
    ]),
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.dataset.menuSheetNav),
    )
    .toBeUndefined();
});

test("the FX sheet slides up, eases between heights and slides down", async ({
  page,
}) => {
  await page.goto("/");
  await recordMotion(page);
  const tabs = page.getByRole("navigation", { name: "Editor" });
  await tabs.getByRole("button", { name: "FX" }).click();
  const fx = page.locator(".fx-panel");
  await expect(fx).toBeVisible();
  await expect.poll(() => motion(page)).toContain("fx-panel:mobile-sheet-in");

  await page.getByRole("button", { name: "Full height" }).click();
  await expect.poll(() => motion(page)).toContain("fx-panel:height");

  await page.getByRole("button", { name: "Close FX" }).click();
  await expect.poll(() => motion(page)).toContain("fx-panel:mobile-sheet-out");
  await expect(fx).toBeHidden();
});

test("the Media sheet and its header slide up together and back down", async ({
  page,
}) => {
  await page.goto("/");
  await recordMotion(page);
  const tabs = page.getByRole("navigation", { name: "Editor" });
  await tabs.getByRole("button", { name: "Media" }).click();
  await expect(page.getByRole("button", { name: "Camera roll" })).toBeVisible();
  await expect
    .poll(() => motion(page))
    .toEqual(
      expect.arrayContaining([
        "mobile-media-header:mobile-sheet-in-screen",
        "media-drawer:transform",
      ]),
    );

  await page.getByRole("button", { name: "Close media" }).click();
  await expect(page.getByRole("button", { name: "Camera roll" })).toHaveCount(
    0,
  );
  await expect
    .poll(() => motion(page))
    .toContain("mobile-media-header:mobile-sheet-out-screen");
  await expect(page.locator(".mobile-media-header")).toHaveCount(0);
});

test("with reduced motion nothing slides", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await recordMotion(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  const sheet = page.locator(".mobile-menu-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("menuitem", { name: "File" }).click();
  await expect(sheet.locator(".mobile-menu-sheet__back")).toHaveText("File");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  const tabs = page.getByRole("navigation", { name: "Editor" });
  await tabs.getByRole("button", { name: "FX" }).click();
  await page.getByRole("button", { name: "Full height" }).click();
  await page.getByRole("button", { name: "Close FX" }).click();
  await expect(page.locator(".fx-panel")).toBeHidden();

  const started = await motion(page);
  expect(started).toContain("mobile-sheet:mobile-sheet-fade-in");
  expect(
    started.filter((name) => /sheet-(in|out)\b|:height$/.test(name)),
  ).toEqual([]);
  expect(await levelSlides(page)).toEqual([]);
});
