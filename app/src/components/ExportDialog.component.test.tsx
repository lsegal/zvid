import { useState } from "react";
import { describe, expect, test } from "vitest";
import { type Locator, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE, signatureById } from "../app/constants.ts";
import type { ProjectState } from "../app/types.ts";
import { setViewport } from "../component-test/viewport.ts";
import { createFillClip } from "../fill-clip.ts";
import { useExport, useExportState } from "../hooks/useExport.ts";
import { ExportDialog } from "./ExportDialog";

// Export opens a dialog pre-filled with the Session Settings, where the
// output can be overridden for this export only. The overrides are kept for
// the next Export while the Session Settings stay as they were.

// The default 1920x1080, 30 fps session with one fill clip, so it has
// something to export.
const PROJECT: ProjectState = {
  ...INITIAL_PROJECT_STATE,
  clips: [
    createFillClip({
      id: "fill-1",
      laneId: INITIAL_PROJECT_STATE.lanes[0].id,
      startQ: 0,
      durationQ: 8,
      bpm: INITIAL_PROJECT_STATE.bpm,
      tint: "#334",
      accent: "#f80",
    }),
  ],
};

// The app's wiring of the Export button to useExport and the dialog.
function ExportHost() {
  const exportState = useExportState();
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setStatus] = useState("");
  const { openExportDialog, exportDialog } = useExport({
    ...exportState,
    project: PROJECT,
    mediaItems: [],
    audioPeaks: undefined,
    signature: signatureById(PROJECT.signatureId),
    beatUnit: 1,
    isPlaying,
    setIsPlaying,
    setStatus,
  });
  return (
    <>
      <button onClick={openExportDialog} type="button">
        Export
      </button>
      <ExportDialog model={exportDialog} />
    </>
  );
}

async function openExportDialog() {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect.element(dialog).toBeVisible();
  return dialog;
}

// Picks an option from one of the dialog's dropdowns.
async function pick(dialog: Locator, name: string, option: string) {
  await dialog.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function frameRate(dialog: Locator) {
  return dialog.getByRole("combobox", { name: "Frame rate" });
}

function modifiedDots(dialog: Locator) {
  return dialog.getByRole("img", { name: "Changed from Session Settings" });
}

function modifiedDot(dialog: Locator, field: string) {
  return dialog
    .element()
    .querySelector(
      `[data-export-field="${field}"] [aria-label="Changed from Session Settings"]`,
    );
}

describe("ExportDialog", () => {
  // The dialog's preview renders the session live, so each step is slower
  // than in a static dialog.
  test("opens pre-filled with Session Settings, and overrides leave them unchanged", {
    timeout: 60_000,
  }, async () => {
    // Tall enough for the whole dialog, footer included.
    await setViewport({ width: 1600, height: 1200 });
    await render(<ExportHost />);

    let dialog = await openExportDialog();
    await expect.element(dialog.getByLabelText("Width")).toHaveValue(1920);
    await expect.element(dialog.getByLabelText("Height")).toHaveValue(1080);
    await expect.element(frameRate(dialog)).toHaveTextContent("30 fps");
    await expect
      .element(dialog.getByLabelText("File name"))
      .toHaveValue(expect.stringMatching(/\.mp4$/));
    expect(modifiedDots(dialog).elements()).toHaveLength(0);

    // Override the size, frame rate and codec for this export.
    await pick(dialog, "Resolution preset", "720p 16:9");
    await pick(dialog, "Frame rate", "60 fps");
    await pick(dialog, "Video codec", "Auto (best available)");
    expect(modifiedDot(dialog, "resolution")).not.toBeNull();
    expect(modifiedDot(dialog, "fps")).not.toBeNull();

    // Closing keeps the overrides for the next Export.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    dialog = await openExportDialog();
    await expect.element(frameRate(dialog)).toHaveTextContent("60 fps");
    await expect.element(dialog.getByLabelText("Width")).toHaveValue(1280);

    // Reset restores the Session Settings, which never changed.
    await dialog
      .getByRole("button", { name: "Reset to session settings" })
      .click();
    await expect.element(frameRate(dialog)).toHaveTextContent("30 fps");
    await expect.element(dialog.getByLabelText("Width")).toHaveValue(1920);
    await expect.element(dialog.getByLabelText("Height")).toHaveValue(1080);
    expect(modifiedDots(dialog).elements()).toHaveLength(0);
  });
});
