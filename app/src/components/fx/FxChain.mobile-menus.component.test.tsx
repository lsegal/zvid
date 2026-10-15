import { useState } from "react";
import { describe, expect, test } from "vitest";
import { type Locator, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { buildOrderLayerOptions } from "../../app/fx-panel-model.ts";
import type { Lane } from "../../app/types.ts";
import { DesktopShell, PhoneShell } from "../../component-test/shells.tsx";
import {
  emulateTouch,
  PHONE_VIEWPORT,
  setViewport,
  useTablet,
} from "../../component-test/viewport.ts";
import {
  addEffect,
  ensureGlobalOrder,
  mapSessionEffectsToDevices,
  type SessionEffect,
  setEffectParameter,
} from "../../fx-stack.ts";
import { FxChain } from "./FxChain";

// On a phone, dropdown menus open as the same bottom sheet as the
// timeline's long-press menu, with submenus shown in place behind a Back
// row (#1198). Tablets and desktops keep their popovers.

const noop = () => {};

const LANES: Lane[] = [
  { id: "lane-1", name: "Layer 1", colorIndex: 0 },
  { id: "lane-2", name: "Layer 2", colorIndex: 1 },
];
const LAYERS = buildOrderLayerOptions(LANES);

// Layer 1's FX chain, with the Global Order a new session starts with.
// Adding a device and setting a parameter edit the effects as the app does.
function LayerChain() {
  const [effects, setEffects] = useState<SessionEffect[]>(() =>
    ensureGlobalOrder([]),
  );
  return (
    <section className="fx-panel">
      <div className="fx-panel__body">
        <FxChain
          devices={mapSessionEffectsToDevices(effects, "lane-1", "Layer 1")}
          kind={undefined}
          layerName="Layer 1"
          layerTrackId="lane-1"
          layers={LAYERS}
          onAdd={(trackId, effectName, id) =>
            setEffects((current) =>
              addEffect(current, trackId, effectName, undefined, id),
            )
          }
          onClearAll={noop}
          onCopy={noop}
          onCut={noop}
          onDuplicate={noop}
          onMove={noop}
          onMoveToStack={noop}
          onPaste={noop}
          onRemove={noop}
          onReset={noop}
          onSetEnabled={noop}
          onSetParameter={(device, key, value) =>
            setEffects((current) =>
              setEffectParameter(current, device.id, key, value),
            )
          }
        />
      </div>
    </section>
  );
}

async function renderPhoneChain(
  viewport: { width: number; height: number } = PHONE_VIEWPORT,
) {
  await setViewport(viewport);
  await emulateTouch();
  // The FX tab opens the panel as a half-height sheet.
  await render(
    <PhoneShell className="app-shell--fx-half">
      <LayerChain />
    </PhoneShell>,
  );
  return document.querySelector(".fx-panel") as HTMLElement;
}

function sheetElement() {
  return document.querySelector<HTMLElement>(".mobile-menu-sheet");
}

// As Playwright's toBeVisible: in the document, with a box, and not
// visibility: hidden.
function isVisible(element: Element | null) {
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return (
    box.width > 0 &&
    box.height > 0 &&
    element.checkVisibility({ visibilityProperty: true })
  );
}

async function expectVisible(find: () => Element | null) {
  await expect.poll(() => isVisible(find())).toBe(true);
}

async function expectHidden(find: () => Element | null) {
  await expect.poll(() => isVisible(find())).toBe(false);
}

function only(locator: Locator) {
  return () => locator.query();
}

// Whether any of the element shows in the viewport, as Playwright's
// toBeInViewport checks.
function inViewport(element: Element) {
  return new Promise<boolean>((resolve) => {
    const observer = new IntersectionObserver(([entry]) => {
      observer.disconnect();
      resolve(entry.isIntersecting && entry.intersectionRatio > 0);
    });
    observer.observe(element);
  });
}

async function openAddMenu() {
  await page.getByRole("button", { name: "Add device to Global" }).click();
  await expectVisible(sheetElement);
}

describe("FxChain menus on a phone", () => {
  test("FX + opens a sheet whose categories open in place", async () => {
    const fx = await renderPhoneChain();
    await openAddMenu();
    expect(
      document.querySelectorAll("[data-radix-popper-content-wrapper]"),
    ).toHaveLength(0);
    const headings = Array.from(
      sheetElement()?.querySelectorAll(".mobile-menu-sheet__heading") ?? [],
    ).map((heading) => heading.textContent);
    expect(headings).toEqual(["Video", "Audio"]);

    const stylize = page.getByRole("menuitem", { name: "Stylize" });
    await stylize.click();
    const back = () =>
      document.querySelector<HTMLElement>(".mobile-menu-sheet__back");
    await expect.poll(() => back()?.textContent).toBe("Stylize");
    // The categories give way to Stylize's effects.
    const stylizeCategory = () =>
      Array.from(
        sheetElement()?.querySelectorAll("[aria-haspopup='menu']") ?? [],
      ).find((element) => element.textContent?.includes("Stylize")) ?? null;
    await expectHidden(stylizeCategory);
    const negativeSplit = page.getByRole("menuitem", {
      name: /^Negative Split/,
    });
    await expectVisible(only(negativeSplit));
    // Each effect's row spans the sheet, so its description isn't squeezed
    // into a column beside the categories.
    const row = negativeSplit.element().getBoundingClientRect();
    const panel = (sheetElement() as HTMLElement).getBoundingClientRect();
    expect(row.width).toBeGreaterThan(panel.width * 0.85);

    await page.elementLocator(back() as HTMLElement).click();
    await expectHidden(back);
    await expectVisible(only(stylize));

    await stylize.click();
    const devicesBefore = fx.querySelectorAll(".fx-device-panel").length;
    await expectVisible(only(negativeSplit));
    await negativeSplit.click();
    await expectHidden(sheetElement);
    await expect
      .poll(() => fx.querySelectorAll(".fx-device-panel").length)
      .toBe(devicesBefore + 1);
    await expectVisible(
      only(page.getByRole("region", { name: "Negative Split", exact: true })),
    );
  });

  test("a long effect list scrolls inside the sheet", async () => {
    await renderPhoneChain({ width: 412, height: 480 });
    await openAddMenu();
    await page
      .getByRole("menuitem", { name: "Transform", exact: true })
      .click();
    await expectVisible(() =>
      document.querySelector(".mobile-menu-sheet__back"),
    );
    const panel = sheetElement() as HTMLElement;
    // The rows scroll under the grabber, and the sheet stays on screen.
    const body = panel.querySelector(".mobile-menu-sheet__body") as HTMLElement;
    const overflows = body.scrollHeight > body.clientHeight;
    const overscroll = getComputedStyle(body).overscrollBehaviorY;
    // Once it has slid up.
    await expect.poll(() => panel.getAnimations().length).toBe(0);
    const box = panel.getBoundingClientRect();
    expect(overflows).toBe(true);
    expect(overscroll).toBe("contain");
    expect(box.y + box.height).toBeLessThanOrEqual(480 + 1);
    const items = panel.querySelectorAll("[role='menuitem']");
    const last = items[items.length - 1];
    last.scrollIntoView({ block: "nearest" });
    await expect.poll(() => inViewport(last)).toBe(true);
  });

  test("checkbox rows toggle in place, and the backdrop closes the sheet", async () => {
    const fx = await renderPhoneChain();
    const trigger = () =>
      fx.querySelector<HTMLElement>(".fx-layers__trigger") as HTMLElement;
    await page.elementLocator(trigger()).click();
    await expectVisible(sheetElement);
    const row = page.getByRole("menuitemcheckbox").first();
    await expect.element(row).toHaveAttribute("aria-checked", "true");
    await row.click();
    await expectVisible(sheetElement);
    await expect.element(row).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => trigger().textContent).not.toBe("Layers: All");
    await page.getByRole("button", { name: "Close menu" }).click();
    await expectHidden(sheetElement);
  });
});

describe("FxChain menus on a tablet", () => {
  test("keeps the add device popover menu", async () => {
    await useTablet();
    await render(
      <DesktopShell>
        <LayerChain />
      </DesktopShell>,
    );
    await page.getByRole("button", { name: "Add device to Global" }).click();
    await expectVisible(() => document.querySelector(".dropdown-menu-content"));
    expect(document.querySelectorAll(".mobile-menu-sheet")).toHaveLength(0);
  });
});
