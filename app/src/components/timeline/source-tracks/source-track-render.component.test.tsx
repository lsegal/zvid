import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  dropFiles,
  expectCount,
  fileTransfer,
  fixtureFile,
  query,
  renderApp,
} from "../../../component-test/app.tsx";
import { setViewport } from "../../../component-test/viewport.ts";

// With no layer clips, the preview and export render the source tracks as
// layers; once a layer clip exists, they render the layers again. Exporting
// stays in e2e/source-track-render.spec.ts.

const monitor = ".preview-monitor";

async function open() {
  await setViewport({ width: 1600, height: 1200 });
  return renderApp();
}

async function addSourceVideo() {
  await dropFiles(
    query('[data-source-track-drop-target="new-track"]'),
    fileTransfer([await fixtureFile("test-pattern.mp4")]),
  );
  await expectCount(".source-span", 1, 30_000);
}

function expectRenderSource(source: "source-tracks" | "layers") {
  return expect
    .poll(() => document.querySelector(monitor))
    .toHaveAttribute("data-render-source", source);
}

test("the preview renders the source tracks until there is a layer clip", async () => {
  await open();
  await addSourceVideo();
  await expectCount(".clip-card", 0);

  // The source media plays at the playhead, so nothing covers the preview.
  await expectRenderSource("source-tracks");
  await expectCount(".preview-placeholder", 0, 30_000);
  await expect
    .poll(() => query(".preview-panel__clip").textContent)
    .not.toBe("No clip at playhead");
  // The source tracks don't show as layers in the timeline.
  await expectCount("[data-timeline-lane-id^='source-render:']", 0);

  // Ctrl/Cmd-click on a source clip drops it on the arrangement.
  await userEvent.click(query(".source-span"), {
    modifiers: ["ControlOrMeta"],
  });
  await expectCount(".clip-card", 1);
  await expectRenderSource("layers");

  // Removing the last layer clip renders the source tracks again.
  await userEvent.click(query(".clip-card"));
  await userEvent.keyboard("{Delete}");
  await expectCount(".clip-card", 0);
  await expectRenderSource("source-tracks");
  await expectCount(".preview-placeholder", 0);
}, 90_000);

test("export needs a layer clip or a source track", async () => {
  await open();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect
    .element(page.getByText("Open a session or import media before exporting."))
    .toBeVisible();
  expect(page.getByRole("dialog").elements()).toHaveLength(0);
}, 60_000);
