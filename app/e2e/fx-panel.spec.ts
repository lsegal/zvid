// Needs App's whole layout: a tall FX row must leave the arrangement's layer headers usable.
import { expect, test } from "@playwright/test";
import { addEffect } from "../src/fx/stack/ops.ts";
import type { SessionEffect } from "../src/fx/stack/types.ts";
import { addableEffectsFor } from "../src/fx-chain.ts";
import { writeProjectArchive } from "../src/project-archive.ts";
import type { ProjectSession } from "../src/session.ts";

// A tall device chain must not squeeze the arrangement on a short window:
// the FX panel is capped and its device chain scrolls instead.

test.use({ viewport: { width: 1280, height: 720 } });

// A session whose Layer 3 holds every effect a layer can take, with the
// defaults each gets when added, so its chain holds the tallest device.
// Opening it builds the chain in one step: adding each effect through the
// layer menu took most of the test's time, and more with every new effect.
async function tallChainArchive() {
  let effects: SessionEffect[] = [];
  for (const id of ["1", "2", "3"]) {
    effects = addEffect(effects, id, "Layout");
  }
  for (const { effectName } of addableEffectsFor("layer")) {
    effects = addEffect(effects, "3", effectName);
  }
  const project: ProjectSession = {
    mainTracks: ["1", "2", "3"].map((id) => ({
      id,
      name: `Layer ${id}`,
      colorIndex: -1,
    })),
    effects: effects.map(({ parameters, ...effect }) => ({
      ...effect,
      parameters: Object.fromEntries(
        parameters.map(({ key, value, numericValue }) => [
          key,
          typeof numericValue === "number"
            ? { floatValue: numericValue }
            : { stringValue: value },
        ]),
      ),
    })),
    clipContentEffects: true,
    audioGainDefaulted: true,
  };
  const blob = await writeProjectArchive({ project, media: [] });
  return {
    buffer: Buffer.from(await blob.arrayBuffer()),
    devices: effects.filter((effect) => effect.trackId === "3").length,
  };
}

test("a tall FX device keeps the arrangement usable", async ({ page }) => {
  const { buffer, devices } = await tallChainArchive();
  await page.goto("/");
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await page.getByRole("menuitem", { name: "Session…", exact: true }).click();
  await (await choosing).setFiles({
    name: "Tall.zvd",
    mimeType: "application/gzip",
    buffer,
  });
  const layerHeader = page.locator('[data-layer-header-id="3"]');
  await layerHeader.click();
  // Layer 3's chain, after the Global stack's Order.
  await expect(page.locator(".fx-panel .fx-device-panel")).toHaveCount(
    devices + 1,
  );

  const editor = await page.locator(".editor-panel").boundingBox();
  const fxPanel = await page.locator(".fx-panel").boundingBox();
  expect(editor?.height).toBeGreaterThanOrEqual(fxPanel?.height ?? 0);

  // The layer headers stay clickable above the FX panel.
  await layerHeader.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Layer header actions" }),
  ).toBeVisible();
});
