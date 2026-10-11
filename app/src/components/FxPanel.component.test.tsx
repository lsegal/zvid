import { beforeEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DesktopShell } from "../component-test/shells.tsx";
import { setViewport, usePhone } from "../component-test/viewport.ts";
import { addEffect, ensureLayerLayouts } from "../fx-stack";
import { addTextClip } from "../text-clip.ts";
import { FxPanel } from "./FxPanel";
import {
  type FixtureSession,
  FixtureFxPanel,
  PhoneEditor,
} from "./mobile/phone-editor.fixture.tsx";

// On a phone, the FX sheet's device and Animation panels reflow their
// properties by width instead of growing sideways, so nothing is clipped
// at the panel's edges (#1218). Desktop panels keep their layout.

// A selected text clip, with a labeled-knob-row device (Move), color
// wheels and a curve (Levels) and many knobs (EQ) on its layer.
function textClipSession(): FixtureSession {
  const lanes = [{ id: "1", name: "Layer 1", colorIndex: 0 }];
  const text = addTextClip(
    { clips: [], effects: ensureLayerLayouts([], ["1"]) },
    {
      id: "text-clip",
      laneId: "1",
      startQ: 0,
      durationQ: 8,
      bpm: 120,
      tint: "#334",
      accent: "#f80",
      effectId: "text-effect",
    },
  );
  let effects = text.effects;
  for (const name of ["Move", "Levels", "EQ"]) {
    effects = addEffect(effects, "1", name);
  }
  return { lanes, effects, clips: [text.clip], selectedClipId: "text-clip" };
}

// Every visible element of each panel, outside its panel's edges.
function clippedControls(sheet: Element) {
  const clipped: string[] = [];
  for (const panel of sheet.querySelectorAll(
    ".fx-device-panel, .fx-animation-panel",
  )) {
    const edges = panel.getBoundingClientRect();
    if (!edges.width) {
      continue;
    }
    for (const element of panel.querySelectorAll("*")) {
      const box = element.getBoundingClientRect();
      if (box.width && (box.left < edges.left - 1 || box.right > edges.right + 1)) {
        clipped.push(`${panel.getAttribute("aria-label")}: ${element.className}`);
      }
    }
  }
  return clipped;
}

function scrollsSideways(sheet: Element) {
  const body = sheet.querySelector(".fx-panel__body") as HTMLElement;
  return body.scrollWidth > body.clientWidth;
}

function overlaps(a: DOMRect, b: DOMRect) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe(FxPanel.name, () => {
  for (const width of [360, 430]) {
    test(`a ${width}px phone fits every FX property in its panel`, async () => {
      await usePhone({ width, height: 820 });
      await render(<PhoneEditor session={textClipSession()} />);
      await page
        .getByRole("navigation", { name: "Editor" })
        .getByRole("button", { name: "FX" })
        .click();
      const fx = document.querySelector(".fx-panel") as HTMLElement;
      await expect.element(fx).toBeVisible();
      expect(
        fx.querySelector(".mobile-sheet-header__title")?.textContent,
      ).toContain("Clip Text");

      // The text animates in Reactive mode, with its Reactivity knob.
      await page.getByRole("button", { name: "Animation", exact: true }).click();
      const animation = page.getByRole("region", { name: "Text animation" });
      await animation
        .getByRole("group", { name: "Mode" })
        .getByRole("button", { name: "Reactive" })
        .click();
      await page.getByRole("button", { name: "Devices", exact: true }).click();

      // Devices: wheels, curves, knob rows and many knobs wrap in the panel.
      for (const name of ["Move", "Levels", "EQ", "Text"]) {
        await expect
          .element(page.getByRole("region", { name, exact: true }))
          .toBeVisible();
      }
      expect(clippedControls(fx)).toEqual([]);
      expect(scrollsSideways(fx)).toBe(false);

      // Each of the Move's Start and End rows keeps its label beside its
      // first knob.
      const row = fx.querySelector(".fx-device-panel__knob-row") as Element;
      const label = row
        .querySelector(".fx-device-panel__row-label")
        ?.getBoundingClientRect();
      const knob = row.querySelector(".knob")?.getBoundingClientRect();
      expect(label && knob && label.x + label.width <= knob.x).toBe(true);
      expect(
        label &&
          knob &&
          label.y < knob.y + knob.height &&
          knob.y < label.y + 20,
      ).toBe(true);

      // Animation: Mode, Timing, Reactivity, Motion and Parameters all show
      // whole, with no two overlapping.
      await page.getByRole("button", { name: "Animation", exact: true }).click();
      await expect.element(animation).toBeVisible();
      expect(clippedControls(fx)).toEqual([]);
      expect(scrollsSideways(fx)).toBe(false);
      const section = animation.element();
      const parts = [
        animation.getByRole("group", { name: "Mode" }).element(),
        animation.getByRole("group", { name: "Timing" }).element(),
        section.querySelector(".fx-animation-panel__knob"),
        [...section.querySelectorAll(".fx-select")].find((select) =>
          select.textContent?.includes("Motion"),
        ),
        section.querySelector(".fx-animation-panel__parameters"),
      ];
      const boxes = parts.map((part) => part?.getBoundingClientRect() ?? null);
      for (const [index, box] of boxes.entries()) {
        expect(box, `part ${index}`).not.toBeNull();
        expect(box?.width, `part ${index}`).toBeGreaterThan(0);
        for (const other of boxes.slice(index + 1)) {
          expect(box && other && overlaps(box, other)).toBe(false);
        }
      }
      // Segmented options stay finger-sized.
      for (const option of animation
        .getByRole("group", { name: "Mode" })
        .getByRole("button")
        .elements()) {
        expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(36);
      }
    });
  }

  test("desktop FX panels keep their row-limited layout", async () => {
    await setViewport({ width: 1280, height: 800 });
    await render(
      <DesktopShell>
        <FixtureFxPanel session={textClipSession()} />
      </DesktopShell>,
    );
    const text = page.getByRole("region", { name: "Text", exact: true });
    await expect.element(text).toBeVisible();
    const flow = (selector: string) =>
      getComputedStyle(document.querySelector(selector) as Element)
        .gridAutoFlow;
    expect(flow(".fx-animation-panel__body")).toBe("column");
    expect(flow(".fx-device-panel__controls")).toBe("column");
    const columns = text
      .element()
      .querySelector(".fx-device-panel__body--columns") as Element;
    expect(getComputedStyle(columns).display).toBe("flex");
    const knobRow = document.querySelector(
      ".fx-device-panel__knob-row",
    ) as Element;
    expect(getComputedStyle(knobRow).display).toBe("contents");
  });
});
