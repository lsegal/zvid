import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { FX_PANEL_HEIGHT_STORAGE_KEY } from "../app/constants.ts";
import { renderApp } from "../component-test/app.tsx";
import { addFromMenu } from "../component-test/fx-actions.ts";
import { center, dblclick, drag, nextFrames } from "../component-test/input.ts";
import { setViewport } from "../component-test/viewport.ts";

// The FX panel's handle against the App layout it trades space with.

const query = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`No ${selector}`);
  }
  return element;
};
const height = (selector: string) =>
  query(selector).getBoundingClientRect().height;
const handle = () => query(".fx-panel-resize-handle");

// The MIDI sample's Arp clip, whose Clip and Notes regions lead the chain.
async function openMidiClip() {
  await userEvent.click(
    page.getByRole("menuitem", { name: "File", exact: true }),
  );
  await userEvent.click(
    page.getByRole("menuitem", { name: "Open", exact: true }),
  );
  await userEvent.click(
    page.getByRole("menuitem", { name: "Samples", exact: true }),
  );
  await userEvent.click(
    page.getByRole("menuitem", { name: "MIDI", exact: true }),
  );
  const clip = () =>
    [...document.querySelectorAll<HTMLElement>("[data-source-span-id]")].find(
      (span) => span.textContent?.startsWith("Arp"),
    );
  await expect.poll(clip, { timeout: 30_000 }).toBeTruthy();
  await userEvent.click(clip() as HTMLElement);
  await expect.poll(() => document.querySelector(".piano-roll")).not.toBeNull();
}

describe("FX panel resizing", { timeout: 60_000 }, () => {
  test("dragging the top edge trades height with the editor panel", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const panelBefore = height(".fx-panel");
    const editorBefore = height(".editor-panel");

    const start = center(handle());
    await drag(start, { x: start.x, y: start.y - 60 });
    await expect
      .poll(() => height(".fx-panel"))
      .toBeCloseTo(panelBefore + 60, 0);
    expect(height(".editor-panel")).toBeCloseTo(editorBefore - 60, 0);
    expect(localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY)).toBe(
      String(Math.round(panelBefore + 60)),
    );
  });

  test("the panel stops short of the editor and stays in the window", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();

    const start = center(handle());
    await drag(start, { x: start.x, y: 0 });
    await nextFrames();
    expect(height(".editor-panel")).toBeGreaterThanOrEqual(220);

    // A shorter window takes it down with it, without saving a new height.
    const saved = localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY);
    await setViewport({ width: 1280, height: 600 });
    await nextFrames();
    expect(height(".editor-panel")).toBeGreaterThanOrEqual(220);
    expect(
      query(".fx-panel").getBoundingClientRect().bottom,
    ).toBeLessThanOrEqual(query(".status-bar").getBoundingClientRect().top);
    expect(localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY)).toBe(saved);
  });

  test("the keyboard resizes it and a double-click fits the contents", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const fitted = height(".fx-panel");

    handle().focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(() => height(".fx-panel")).toBeCloseTo(fitted + 16, 0);
    await userEvent.keyboard("{Home}");
    await expect.poll(() => height(".fx-panel")).toBe(120);

    const { x, y } = center(handle());
    await dblclick(x, y);
    await expect.poll(() => height(".fx-panel")).toBeCloseTo(fitted, 0);
    expect(localStorage.getItem(FX_PANEL_HEIGHT_STORAGE_KEY)).toBeNull();
  });

  test("a collapsed panel has no handle and only its header's height", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const start = center(handle());
    await drag(start, { x: start.x, y: start.y - 60 });

    query(".fx-panel__toggle").click();
    await expect
      .poll(() => document.querySelector(".fx-panel-resize-handle"))
      .toBeNull();
    expect(height(".fx-panel")).toBeLessThan(60);
  });

  test("cut-off content shows a scrollbar, even with overlay scrollbars", async () => {
    await setViewport({ width: 1280, height: 720 });
    await renderApp();
    const start = center(handle());
    await drag(start, { x: start.x, y: innerHeight - 1 });
    await expect.poll(() => height(".fx-panel")).toBe(120);

    const body = query(".fx-panel__body");
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    // Either standard property would leave macOS's overlay scrollbar, hidden
    // until a scroll, in place of the app's ::-webkit-scrollbar styles. (The
    // width itself is 0 where Playwright hides scrollbars, as headless does.)
    const style = getComputedStyle(body);
    expect(style.scrollbarWidth).toBe("auto");
    expect(style.scrollbarColor).toBe("auto");
    expect(getComputedStyle(body, "::-webkit-scrollbar").width).toBe("10px");
  });

  test("the Clip and Notes regions render into the panel's height", async () => {
    await setViewport({ width: 1389, height: 800 });
    await renderApp();
    await openMidiClip();
    handle().focus();

    // Taller than the chain's devices: nothing scrolls, and the regions end
    // at the chain's bottom edge with no dead space under their contents.
    await userEvent.keyboard("{End}");
    await nextFrames();
    const body = query(".fx-panel__body");
    expect(body.scrollHeight).toBe(body.clientHeight);
    const bottom = (selector: string) =>
      query(selector).getBoundingClientRect().bottom;
    const tallRoll = height(".piano-roll__scroll");
    expect(bottom(".piano-roll__scroll")).toBeCloseTo(
      bottom(".piano-roll") - 11,
      0,
    );
    // Above the chain's bottom padding, and its scrollbar where those take room.
    const chain = query(".fx-chain");
    expect(bottom(".piano-roll")).toBeCloseTo(
      chain.getBoundingClientRect().top + chain.clientHeight - 16,
      0,
    );
    // The Clip frame fills the height too, but its fields stay packed at the
    // top rather than stretching down to its bottom edge.
    const fields = document.querySelectorAll<HTMLElement>(
      ".source-clip-properties__fields > *",
    );
    expect(bottom(".source-clip-properties")).toBeCloseTo(
      bottom(".piano-roll"),
      0,
    );
    expect(
      fields[1].getBoundingClientRect().top -
        fields[0].getBoundingClientRect().bottom,
    ).toBeCloseTo(8, 0);

    // Shorter, the roll gives up height before the body starts to scroll.
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await nextFrames();
    expect(height(".piano-roll__scroll")).toBeCloseTo(tallRoll - 32, 0);
    expect(body.scrollHeight).toBe(body.clientHeight);
  });

  describe("on a short panel", () => {
    const body = () => query(".fx-panel__body");
    const clips = () =>
      [
        ...document.querySelectorAll<HTMLElement>("[data-source-span-id]"),
      ].filter((span) => span.textContent?.includes("MIDI"));
    const device = (name: string) => query(`.fx-chain [aria-label="${name}"]`);
    const limit = () =>
      Number.parseFloat(
        body().style.getPropertyValue("--fx-device-max-height"),
      );
    const addToLayer = (category: string, item: string, group: string) =>
      addFromMenu("Add device to this layer", category, item, group);
    const shortenPanel = async (steps: number) => {
      handle().focus();
      await userEvent.keyboard("{ArrowDown}".repeat(steps));
      await nextFrames();
    };
    const growPanel = async () => {
      handle().focus();
      await userEvent.keyboard("{End}");
      await nextFrames();
    };
    const rowCount = (section: HTMLElement) =>
      getComputedStyle(
        section.querySelector(".fx-animation-panel__body") as HTMLElement,
      ).gridTemplateRows.split(" ").length;

    test("the MIDI sample's clips fit the fitted panel without scrolling", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await openMidiClip();
      expect(clips().length).toBeGreaterThan(0);

      for (const clip of clips()) {
        await userEvent.click(clip);
        await nextFrames();
        expect(body().scrollHeight, clip.textContent ?? "").toBe(
          body().clientHeight,
        );
      }
    });

    test("tall devices reflow only when they need to, with their controls packed at the top", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await openMidiClip();
      const synth = device("Synth");
      const short = synth.getBoundingClientRect().height;
      expect(synth.dataset.fxLayout).toBeDefined();
      const knobs = () =>
        [...synth.querySelectorAll<HTMLElement>(".knob")].map(
          (knob) => knob.getBoundingClientRect().top,
        );
      expect(new Set(knobs()).size).toBe(1);
      expect(knobs()[0] - synth.getBoundingClientRect().top).toBeLessThan(60);

      // With height to spare, the usual layout comes back.
      handle().focus();
      await userEvent.keyboard("{End}");
      await nextFrames();
      expect(device("Synth").dataset.fxLayout).toBeUndefined();
      expect(new Set(knobs()).size).toBe(2);
      expect(device("Synth").getBoundingClientRect().height).toBeGreaterThan(
        short,
      );
    });

    test("Levels fits the fitted panel, with its wheels and curve shorter", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await addToLayer("Color", "Levels", "Video");
      await nextFrames();

      const levels = device("Levels");
      expect(levels.dataset.fxLayout).toBeDefined();
      expect(levels.getBoundingClientRect().height).toBeLessThanOrEqual(
        limit(),
      );
      expect(body().scrollHeight).toBe(body().clientHeight);
      const curve = () => query(".fx-curve__plot").getAttribute("viewBox");
      const short = curve();

      // Controls stay packed at the top, the wheels in their one row.
      const wheels = [...levels.querySelectorAll<HTMLElement>(".fx-wheel")];
      expect(new Set(wheels.map((wheel) => wheel.offsetTop)).size).toBe(1);

      // With height to spare, the usual layout comes back.
      await growPanel();
      expect(device("Levels").dataset.fxLayout).toBeUndefined();
      expect(height(".fx-wheel__disc")).toBe(88);
      expect(curve()).toBe("0 0 280 140");
      expect(short).not.toBe(curve());
    });

    test("Levels keeps its curve tab as the panel resizes", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await addToLayer("Color", "Levels", "Video");
      await nextFrames();
      const tab = () =>
        page.elementLocator(device("Levels")).getByRole("button", {
          name: "R curve",
          exact: true,
        });
      await userEvent.click(tab());

      await growPanel();
      await expect.element(tab()).toHaveAttribute("aria-pressed", "true");
    });

    test("a short panel's smaller wheel moves its puck with the pointer", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await addToLayer("Color", "Levels", "Video");
      await nextFrames();
      await shortenPanel(4);
      expect(device("Levels").dataset.fxLayout).toBe("2");

      const disc = query(".fx-wheel__disc");
      disc.scrollIntoView({ block: "nearest", inline: "nearest" });
      await nextFrames();
      const { width } = disc.getBoundingClientRect();
      expect(width).toBeLessThan(88);
      const start = center(disc);
      await drag(start, { x: start.x + width / 2, y: start.y });
      await expect
        .poll(() => Number(disc.getAttribute("aria-valuenow")))
        .toBeGreaterThanOrEqual(95);
    });

    test("Scopes fits the fitted panel, its waveform drawn at the shorter size", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await addToLayer("Color", "Scopes", "Video");
      await nextFrames();

      const scopes = device("Scopes");
      expect(scopes.dataset.fxLayout).toBeDefined();
      expect(scopes.getBoundingClientRect().height).toBeLessThanOrEqual(
        limit(),
      );
      expect(body().scrollHeight).toBe(body().clientHeight);
      // Drawn for its height rather than stretched to it.
      const scope = query<HTMLCanvasElement>(".fx-waveform__scope");
      const aspect = () => scope.height / scope.width;
      expect(aspect()).toBeCloseTo(
        Number.parseFloat(scope.style.height) / 288,
        3,
      );
      expect(Number.parseFloat(scope.style.height)).toBeLessThan(168);

      await growPanel();
      expect(device("Scopes").dataset.fxLayout).toBeUndefined();
      expect(scope.style.height).toBe("168px");
      await expect.poll(aspect).toBeCloseTo(168 / 288, 3);
    });

    test("an attached section takes one row when it doesn't fit its usual two", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await addToLayer("Color", "Contrast", "Video");
      await userEvent.click(
        page.getByRole("button", { name: "Turn Animation On for Contrast" }),
      );
      await nextFrames();
      const animation = () => device("Contrast animation");

      // The two rows fit the fitted panel, and it doesn't scroll for them.
      expect(animation().dataset.fxLayout).toBeUndefined();
      expect(rowCount(animation())).toBe(2);
      expect(animation().getBoundingClientRect().height).toBeLessThanOrEqual(
        limit(),
      );
      expect(body().scrollHeight).toBe(body().clientHeight);

      await shortenPanel(4);
      expect(animation().dataset.fxLayout).toBe("1");
      expect(rowCount(animation())).toBe(1);
      // Every mode's controls keep to it, the knobs included.
      for (const mode of ["Reactive", "LFO"]) {
        await userEvent.click(
          page
            .elementLocator(animation())
            .getByRole("button", { name: mode, exact: true }),
        );
        await nextFrames();
        expect(rowCount(animation()), mode).toBe(1);
      }

      await addToLayer("Volume & Stereo", "Gain", "Audio");
      await userEvent.click(
        page.getByRole("button", { name: "Turn Modulation On for Gain" }),
      );
      await nextFrames();
      expect(device("Gain modulation").dataset.fxLayout).toBe("1");
      expect(rowCount(device("Gain modulation"))).toBe(1);

      await growPanel();
      expect(rowCount(animation())).toBe(2);
      expect(rowCount(device("Gain modulation"))).toBe(2);
    });

    test("resizing and fitting settle on one layout", async () => {
      await setViewport({ width: 1389, height: 800 });
      await renderApp();
      await openMidiClip();

      const layouts = () =>
        [...document.querySelectorAll<HTMLElement>("[data-fx-layout]")].map(
          (element) => element.dataset.fxLayout,
        );
      // Holds still for a while, seen frame by frame.
      const expectSettled = async () => {
        const panel = height(".fx-panel");
        const shown = layouts();
        for (let frame = 0; frame < 10; frame += 1) {
          await nextFrames();
          expect(height(".fx-panel")).toBe(panel);
          expect(layouts()).toEqual(shown);
        }
      };
      const fitted = height(".fx-panel");
      const fittedLayouts = layouts();
      await expectSettled();

      handle().focus();
      for (let step = 0; step < 16; step += 1) {
        await userEvent.keyboard("{ArrowUp}");
        await nextFrames();
        await expectSettled();
      }

      const { x, y } = center(handle());
      await dblclick(x, y);
      await nextFrames();
      await expectSettled();
      expect(height(".fx-panel")).toBe(fitted);
      expect(layouts()).toEqual(fittedLayouts);
    });
  });
});
