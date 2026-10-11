import { expect, test } from "@playwright/test";
import { addEffect } from "../src/fx/stack/ops.ts";
import type { SessionEffect } from "../src/fx/stack/types.ts";
import { addableEffectsFor } from "../src/fx-chain.ts";
import { writeProjectArchive } from "../src/project-archive.ts";
import type { ProjectSession } from "../src/session.ts";
import { addLayers } from "./layers.ts";

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

// Knobs fill at most two rows: Transform reads X Y Width Height, then
// Origin X Origin Y Rotation.
test("Transform lays its knobs out in two rows", async ({ page }) => {
  await page.goto("/");
  await addLayers(page);
  const layerHeader = page.locator('[data-layer-header-id="3"]');
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name: /^Transform/ })
    .click();

  const knobs = page.locator(
    'section[aria-label="Transform"] .fx-device-panel__body > *',
  );
  await expect(knobs).toHaveCount(7);
  const rows = new Map<number, string[]>();
  for (const knob of await knobs.all()) {
    const top = Math.round((await knob.boundingBox())?.y ?? 0);
    const label = (await knob.locator(".knob__label").textContent()) ?? "";
    rows.set(top, [...(rows.get(top) ?? []), label]);
  }
  expect(
    [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row),
  ).toEqual([
    ["X", "Y", "Width", "Height"],
    ["Origin X", "Origin Y", "Rotation"],
  ]);
});

// Move puts its Motion curve on its own row, then a Start row and an End row
// of Transform's knobs, each led by its label.
test("Move lays out Motion, then labeled Start and End rows", async ({
  page,
}) => {
  await page.goto("/");
  await addLayers(page);
  const layerHeader = page.locator('[data-layer-header-id="3"]');
  await layerHeader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add FX", exact: true }).hover();
  await page
    .getByRole("menu", { name: "Add FX" })
    .getByRole("menuitem", { name: /^Move/ })
    .click();

  const move = page.locator('section[aria-label="Move"]');
  const motion = move.getByRole("group", { name: "Motion" });
  await expect(motion.getByRole("button")).toHaveText([
    "Linear",
    "Ease In",
    "Ease Out",
    "Ease In Out",
  ]);
  await expect(
    motion.getByRole("button", { name: "Ease In Out" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Each row's label sits left of its knobs, which share one line below the
  // previous row's.
  let previousTop = (await motion.boundingBox())?.y ?? 0;
  for (const name of ["Start", "End"]) {
    const row = move.getByRole("group", { name });
    const labels = row.locator(".knob__label");
    await expect(labels).toHaveText([
      "X",
      "Y",
      "Width",
      "Height",
      "Origin X",
      "Origin Y",
      "Rotation",
    ]);
    const tops = new Set<number>();
    for (const label of await labels.all()) {
      tops.add(Math.round((await label.boundingBox())?.y ?? 0));
    }
    expect(tops.size).toBe(1);
    const [top] = tops;
    expect(top).toBeGreaterThan(previousTop);
    previousTop = top;

    const legend = await row.locator("legend").boundingBox();
    const first = await labels.first().boundingBox();
    expect(legend && first && legend.x + legend.width <= first.x).toBe(true);
  }
});

// Every new session arranges its layers with a Vertical Order on the Global
// stack. Removing it can be undone, and leaves the Global section without
// any note about the missing Order.
test("a new session has a Global Order that can be removed and restored", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-layer-header-id="1"]').click();

  const order = page.locator('section[aria-label="Order"]');
  await expect(order).toHaveCount(1);
  await expect(order).toContainText("Vertical");

  await order.getByRole("button", { name: "Remove Order" }).click();
  await expect(order).toHaveCount(0);
  await expect(page.locator(".fx-chain")).not.toContainText("No Order");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(order).toHaveCount(1);
});

// The chain reads GLOBAL | LAYER, and GLOBAL | LAYER | CLIP once a clip is
// selected; the title names the selection.
test("the FX panel shows Global, then the layer, then the selected clip", async ({
  page,
}) => {
  await page.goto("/");
  await addLayers(page, 1);
  const title = page.locator(".fx-panel__toggle");
  const sections = page.locator(".fx-chain [data-fx-divider]");

  await page.locator('[data-layer-header-id="2"]').click();
  await expect(title).toHaveText("Layer 2 Effects");
  await expect(sections).toHaveText(["Global", "Layer"]);
  await expect(
    page.getByRole("button", { name: "Add device to Global" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add device to this clip" }),
  ).toHaveCount(0);

  await page.locator('[data-layer-header-id="2"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Insert text at playhead" }).click();
  await expect(
    page.locator('[data-timeline-lane-id="2"] .clip-card--selected'),
  ).toHaveCount(1);
  await expect(title).toHaveText("Clip Text Effects (Layer 2)");
  await expect(sections).toHaveText(["Global", "Layer", "Clip"]);

  // Global's Order sits left of the layer's devices, which sit left of the
  // clip's add slot.
  const order = await page.locator('section[aria-label="Order"]').boundingBox();
  const layout = await page
    .locator('section[aria-label="Layout"]')
    .boundingBox();
  const addToClip = await page
    .getByRole("button", { name: "Add device to this clip" })
    .boundingBox();
  expect(order?.x ?? 0).toBeLessThan(layout?.x ?? 0);
  expect(layout?.x ?? 0).toBeLessThan(addToClip?.x ?? 0);

  // Adding from the clip slot puts the device on the clip's stack.
  await page.getByRole("button", { name: "Add device to this clip" }).click();
  await page
    .getByRole("menuitem", { name: "Transform", exact: true })
    .press("ArrowRight");
  await page
    .getByRole("menu")
    .last()
    .getByRole("menuitem", { name: /^Transform/ })
    .click();
  const clipTransform = page.locator(
    `.fx-chain :is(section[data-fx-group="clip"], [data-fx-group="clip"] > section)[aria-label="Transform"]`,
  );
  await expect(clipTransform).toHaveCount(1);
});

// The Order's Layers button opens a checkmark menu of every layer. Toggling
// a row leaves the menu open and updates the button, and each toggle is one
// undo step.
test("the Order's Layers menu toggles layers in place", async ({ page }) => {
  await page.goto("/");
  await addLayers(page);
  await page.locator('[data-layer-header-id="1"]').click();

  const order = page.locator('section[aria-label="Order"]');
  // The open menu hides the rest of the page from the accessibility tree.
  const button = order.locator(".fx-layers__trigger");
  await expect(button).toHaveText("Layers: All");

  await button.click();
  const menu = page.getByRole("menu", { name: /^Layers: / });
  await expect(menu).toBeVisible();
  const rows = menu.getByRole("menuitemcheckbox");
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index++) {
    await expect(rows.nth(index)).toHaveAttribute("aria-checked", "true");
  }

  await rows.first().click();
  await expect(menu).toBeVisible();
  await expect(rows.first()).toHaveAttribute("aria-checked", "false");
  await expect(button).toHaveText(`Layers: ${count - 1} of ${count}`);

  // Enter toggles the highlighted row from the keyboard.
  await rows.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(button).toHaveText(`Layers: ${count - 2} of ${count}`);

  await menu.getByRole("menuitem", { name: "Exclude all" }).click();
  await expect(menu).toBeVisible();
  await expect(button).toHaveText("Layers: None");

  await menu.getByRole("menuitem", { name: "Include all" }).click();
  await expect(button).toHaveText("Layers: All");

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(button).toHaveText("Layers: None");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(button).toHaveText(`Layers: ${count - 2} of ${count}`);
});
