import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type Locator, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { INITIAL_PROJECT_STATE, signatureById } from "../app/constants.ts";
import type { ProjectState } from "../app/types.ts";
import { setViewport } from "../component-test/viewport.ts";
import { createFillClip } from "../fill-clip.ts";
import type { Harness, SaveTarget } from "../harness/contracts.ts";
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
function ExportHost({ project = PROJECT }: { project?: ProjectState }) {
  const exportState = useExportState();
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setStatus] = useState("");
  const { openExportDialog, exportDialog } = useExport({
    ...exportState,
    project,
    mediaItems: [],
    audioPeaks: undefined,
    signature: signatureById(project.signatureId),
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

// Picks an option from one of the dialog's dropdowns, then waits for it to
// close: while its listbox is open the dialog is hidden from the
// accessibility tree, so reading the dialog right away can miss it.
async function pick(dialog: Locator, name: string, option: string) {
  await dialog.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
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
    // Tall enough for the whole dialog.
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
    await dialog.getByRole("button", { name: "Dismiss dialog" }).click();
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

  describe("Share", () => {
    const EXPORTED = new Blob(["mp4 bytes"], { type: "video/mp4" });
    let saved: { blob: Blob; target: SaveTarget }[] = [];
    let restore: (() => void)[] = [];

    afterEach(() => {
      for (const undo of restore.reverse()) {
        undo();
      }
      restore = [];
      saved = [];
    });

    // A web harness whose export finishes at once with `exported`, saved
    // through a download.
    function stubHarness(exported = EXPORTED) {
      const previous = window.harness;
      window.harness = {
        id: "web",
        capabilities: {},
        prepareSave: async (filename: string) => ({
          kind: "download",
          filename,
        }),
        saveBlob: async (blob: Blob, target: SaveTarget) => {
          saved.push({ blob, target });
          return "download";
        },
        exportVideo: async (request) => {
          saved.push({ blob: exported, target: request.saveTarget });
          return {
            encoding: {},
            summary: "1920×1080 · 30 fps",
            bytes: exported.size,
            mimeType: exported.type,
            muxedWith: "zvidlib",
            saveMethod: "download",
            blob: exported,
          };
        },
      } as Partial<Harness> as Harness;
      restore.push(() => {
        window.harness = previous;
      });
    }

    // Replaces the browser's Web Share API for the test.
    function stubWebShare(stub: Pick<Navigator, "canShare" | "share">) {
      for (const key of ["canShare", "share"] as const) {
        const own = Object.getOwnPropertyDescriptor(navigator, key);
        Object.defineProperty(navigator, key, {
          configurable: true,
          value: stub[key],
        });
        restore.push(() => {
          if (own) {
            Object.defineProperty(navigator, key, own);
          } else {
            delete (navigator as Partial<Navigator>)[key];
          }
        });
      }
    }

    async function exportVideo(project = PROJECT) {
      await setViewport({ width: 1600, height: 1200 });
      await render(<ExportHost project={project} />);
      const dialog = await openExportDialog();
      await dialog.getByRole("button", { name: "Export", exact: true }).click();
      await expect
        .element(dialog.getByRole("button", { name: "Close", exact: true }))
        .toBeVisible();
      return dialog;
    }

    test("opens the share sheet with the exported video", {
      timeout: 60_000,
    }, async () => {
      stubHarness();
      const share = vi.fn(async (_data?: ShareData) => {});
      stubWebShare({
        canShare: (data?: ShareData) =>
          Boolean(data?.files?.every((file) => file.type === "video/mp4")),
        share,
      });
      const dialog = await exportVideo();

      await dialog.getByRole("button", { name: "Share" }).click();
      await expect.poll(() => share.mock.calls.length).toBe(1);
      const files = share.mock.calls[0][0]?.files ?? [];
      expect(files).toHaveLength(1);
      expect(files[0].name).toMatch(/\.mp4$/);
      expect(files[0].type).toBe("video/mp4");
      // The exported bytes as they were saved, not a new render.
      expect(await files[0].text()).toBe(await EXPORTED.text());
      // Only the export's own save; nothing downloaded again.
      expect(saved).toHaveLength(1);
    });

    test("closing the share sheet is not an error", {
      timeout: 60_000,
    }, async () => {
      stubHarness();
      const share = vi.fn(async () => {
        throw new DOMException("Share canceled", "AbortError");
      });
      stubWebShare({ canShare: () => true, share });
      const dialog = await exportVideo();

      await dialog.getByRole("button", { name: "Share" }).click();
      await expect.poll(() => share.mock.calls.length).toBe(1);
      await share.mock.results[0].value.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 50));
      // A failed share would replace the export's message.
      expect(dialog.getByRole("status").element().textContent).toMatch(
        /^Exported /,
      );
    });

    test("downloads the video where files can't be shared", {
      timeout: 60_000,
    }, async () => {
      stubHarness();
      const share = vi.fn(async () => {});
      stubWebShare({ canShare: () => false, share });
      const dialog = await exportVideo();

      await dialog.getByRole("button", { name: "Share" }).click();
      await expect.poll(() => saved.length).toBe(2);
      expect(share).not.toHaveBeenCalled();
      expect(saved[1].target).toEqual({
        kind: "download",
        filename: expect.stringMatching(/\.mp4$/),
      });
      expect(await saved[1].blob.text()).toBe(await EXPORTED.text());
    });
  });
});
