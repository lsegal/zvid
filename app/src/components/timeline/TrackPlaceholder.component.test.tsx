import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TimelineHarness } from "./timeline-harness";
import { undo } from "./timeline-harness-input";
import { TrackAddButton } from "./TrackPlaceholder";

// The placeholder rows that end the layers and the source tracks: their
// [ + Layer ] and [ + Track ] buttons replace the toolbar's layer count and
// Create Layer button.

const tracks = '[data-source-track-drop-target="track"]';

function headers() {
  return document.querySelectorAll("[data-layer-header-id]");
}

function sourceTracks() {
  return document.querySelectorAll<HTMLElement>(tracks);
}

function addLayer() {
  return page
    .elementLocator(
      document.querySelector(".track-placeholder--layer") as HTMLElement,
    )
    .getByRole("button", { name: "Layer", exact: true });
}

function addTrack() {
  return page
    .elementLocator(
      document.querySelector(".track-row--source-drop") as HTMLElement,
    )
    .getByRole("button", { name: "Track", exact: true });
}

describe(TrackAddButton, { timeout: 60_000 }, () => {
  beforeEach(async () => {
    localStorage.clear();
    await render(<TimelineHarness />);
    await expect.poll(headers).toHaveLength(1);
  });

  test("the toolbar has no layer count or Create Layer button", () => {
    const toolbar = document.querySelector(".timeline-toolbar") as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.textContent).not.toMatch(/Layers \d+\/9/);
    expect(toolbar.textContent).not.toContain("Create Layer");
    expect(toolbar.textContent).not.toContain("Max Layers");
  });

  test("[ + Layer ] ends the layers, adds a layer and selects it", async () => {
    const placeholder = document.querySelector(
      ".track-placeholder--layer",
    ) as HTMLElement;
    // The placeholder is the last row, as tall as a layer row.
    expect(
      [...(placeholder.parentElement?.querySelectorAll(".track-row") ?? [])].at(
        -1,
      ),
    ).toBe(placeholder);
    const layerRows = document.querySelectorAll("[data-layer-row-id]");
    expect(placeholder.getBoundingClientRect().height).toBe(
      layerRows[layerRows.length - 1].getBoundingClientRect().height,
    );

    const count = headers().length;
    await addLayer().click();
    await expect.poll(headers).toHaveLength(count + 1);
    const added = headers()[count];
    expect(added.textContent).toContain(`Layer ${count + 1}`);
    await expect
      .poll(() =>
        added
          .querySelector(".track-label__select")
          ?.getAttribute("aria-current"),
      )
      .toBe("true");

    // One undo step removes it.
    await undo();
    await expect.poll(headers).toHaveLength(count);
  });

  test("[ + Layer ] works from the keyboard", async () => {
    const count = headers().length;
    (addLayer().element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(headers).toHaveLength(count + 1);
    // Space is left to playback and does not press it (#745).
    (addLayer().element() as HTMLElement).focus();
    await userEvent.keyboard("[Space]");
    await userEvent.keyboard("{Enter}");
    await expect.poll(headers).toHaveLength(count + 2);
  });

  test("[ + Layer ] keeps adding layers past 9", async () => {
    while (headers().length < 11) {
      const count = headers().length;
      await addLayer().click();
      await expect.poll(headers).toHaveLength(count + 1);
    }
    const button = addLayer().element() as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("title")).toBe("Add a layer");
  });

  test("[ + Track ] adds an empty source track and selects it", async () => {
    expect(sourceTracks()).toHaveLength(0);
    await addTrack().click();
    await expect.poll(sourceTracks).toHaveLength(1);
    const added = sourceTracks()[0];
    expect(added.textContent).toContain("Source Track 1");
    await expect.poll(() => added.className).toMatch(/track-row--selected/);
    expect(added.querySelectorAll(".source-span")).toHaveLength(0);

    // The placeholder stays the last row, and adds the next track.
    await addTrack().click();
    await expect.poll(sourceTracks).toHaveLength(2);
    expect(sourceTracks()[1].textContent).toContain("Source Track 2");
    await expect
      .poll(() => sourceTracks()[1].className)
      .toMatch(/track-row--selected/);
    expect(sourceTracks()[0].className).not.toMatch(/track-row--selected/);

    // One undo step removes each.
    await undo();
    await expect.poll(sourceTracks).toHaveLength(1);
    await undo();
    await expect.poll(sourceTracks).toHaveLength(0);
  });

  test("[ + Track ] stays enabled while source tracks are locked", async () => {
    await addTrack().click();
    await expect.poll(sourceTracks).toHaveLength(1);
    await page
      .getByRole("button", { name: "Lock source tracks", exact: true })
      .click();
    await expect
      .poll(() => document.querySelectorAll(".source-tracks--locked"))
      .toHaveLength(1);
    expect((addTrack().element() as HTMLButtonElement).disabled).toBe(false);
    await addTrack().click();
    await expect.poll(sourceTracks).toHaveLength(2);
  });
});
