import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { addFromMenu } from "../../../component-test/fx-actions.ts";
import {
  BLACK,
  BLUE,
  CYAN,
  effect,
  expectColors,
  FxClipEditor,
  GREEN,
  insertClip,
  MAGENTA,
  RED,
  renderOrder,
  type Samples,
  withLayersBelow,
} from "../../../component-test/fx-clip.tsx";
import { EMPTY_PROJECT } from "../../../component-test/fx-projects.ts";
import { describeFxClip } from "../../../fx-clip.ts";
import { isOrderEffectName } from "./order.ts";

// The Order effect's border: the color of the gaps between layers, of empty
// grid cells and of the outer margin, on the Global stack and on an FX
// clip, rendered by the compositor the preview and the export share. And
// Order on an FX clip, added from its add menu, lists only the layers
// beneath the clip.

// At 360 px a Spacing of 20 is a 6.7 px gap.
const SIZE = 360;
const spaced = (color?: string) => [
  { key: "Spacing", value: "20", numericValue: 20 },
  ...(color ? [{ key: "BorderColor", value: color }] : []),
];

describe("Order border", { timeout: 60_000 }, () => {
  test("colors the gaps between layers black by default", async () => {
    const pixels = await renderOrder({
      layers: ["#ff0000", "#0000ff"],
      effects: [],
      globalOrder: spaced(),
      playheadSeconds: 1,
      size: SIZE,
      samples: [
        [0.5, 0.25],
        [0.5, 0.5],
        [0.5, 0.75],
      ],
    });
    expectColors(pixels, [RED, BLACK, BLUE]);
  });

  test("colors the gaps and empty grid cells with a custom border", async () => {
    const pixels = await renderOrder({
      layers: ["fx", "#ff0000", "#0000ff", "#ffff00"],
      effects: [
        effect("grid", "clip:fx-1", "Order", {
          Arrangement: "Grid",
          GridSize: 2,
          Spacing: 20,
          BorderColor: "rgba(0,255,0,1)",
        }),
      ],
      playheadSeconds: 1,
      size: SIZE,
      samples: [
        [0.25, 0.25],
        [0.5, 0.25],
        [0.5, 0.5],
        [0.75, 0.75],
      ],
    });
    // A slot, the gap beside it, the gaps' crossing and the empty fourth
    // cell.
    expectColors(pixels, [RED, GREEN, GREEN, GREEN]);

    const global = await renderOrder({
      layers: ["#ff0000", "#0000ff"],
      effects: [],
      globalOrder: spaced("#00ffff"),
      playheadSeconds: 1,
      size: SIZE,
      samples: [[0.5, 0.5]],
    });
    expectColors(global, [CYAN]);
  });

  test("shows what is beneath an FX clip's Order through a transparent border", async () => {
    const scenario = {
      layers: ["fx", "#ff0000", "#0000ff"],
      globalOrder: spaced("#ffffff"),
      playheadSeconds: 1,
      size: SIZE,
      // Layer 2's column, the gap between the columns.
      samples: [
        [0.25, 0.5],
        [0.5, 0.5],
      ] as Samples,
    };
    const fxOrder = (color: string) =>
      effect("columns", "clip:fx-1", "Order", {
        Arrangement: "Horizontal",
        Spacing: 20,
        BorderColor: color,
      });
    const transparent = await renderOrder({
      ...scenario,
      effects: [fxOrder("rgba(255,0,255,0)")],
    });
    // The Global Order's white border is all that is beneath the FX clip.
    expectColors(transparent, [RED, [255, 255, 255]]);

    const opaque = await renderOrder({
      ...scenario,
      effects: [fxOrder("rgba(255,0,255,1)")],
    });
    expectColors(opaque, [RED, MAGENTA]);
  });

  test("frames the arrangement in the border color with an outer margin", async () => {
    // At 360 px a Spacing of 30 is a 10 px margin: the samples 5 px in from
    // the edges fall in it.
    const edges: Samples = [
      [0.5, 5 / SIZE],
      [5 / SIZE, 0.25],
      [1 - 5 / SIZE, 0.75],
      [0.5, 1 - 5 / SIZE],
    ];
    const framed = (color: string) => [
      { key: "Spacing", value: "30", numericValue: 30 },
      { key: "Margin", value: "30", numericValue: 30 },
      { key: "BorderColor", value: color },
    ];
    const global = await renderOrder({
      layers: ["#ff0000", "#0000ff"],
      effects: [],
      globalOrder: framed("#00ff00"),
      playheadSeconds: 1,
      size: SIZE,
      samples: [...edges, [0.5, 0.25], [0.5, 0.5], [0.5, 0.75]],
    });
    expectColors(global, [GREEN, GREEN, GREEN, GREEN, RED, GREEN, BLUE]);

    // Without the margin the layers run to the edges.
    const unframed = await renderOrder({
      layers: ["#ff0000", "#0000ff"],
      effects: [],
      globalOrder: spaced("#00ff00"),
      playheadSeconds: 1,
      size: SIZE,
      samples: edges,
    });
    expectColors(unframed, [RED, RED, BLUE, BLUE]);

    const fxClip = await renderOrder({
      layers: ["fx", "#ff0000", "#0000ff"],
      effects: [
        effect("columns", "clip:fx-1", "Order", {
          Arrangement: "Horizontal",
          Spacing: 30,
          Margin: 30,
          BorderColor: "rgba(255,0,255,1)",
        }),
      ],
      playheadSeconds: 1,
      size: SIZE,
      samples: [...edges, [0.25, 0.5], [0.5, 0.5], [0.75, 0.5]],
    });
    expectColors(fxClip, [
      MAGENTA,
      MAGENTA,
      MAGENTA,
      MAGENTA,
      RED,
      MAGENTA,
      BLUE,
    ]);
  });

  test("exports the border as the preview shows it", async () => {
    const scenario = {
      layers: ["#ff0000", "#0000ff", "#ffff00"],
      effects: [
        effect("grid", "__group_main", "Order", {
          Arrangement: "Grid",
          GridSize: 2,
          Spacing: 50,
          BorderColor: "rgba(255,0,255,1)",
        }),
      ],
      playheadSeconds: 1,
      // A cell, the gap beside it and the empty fourth cell.
      samples: [
        [0.25, 0.25],
        [0.5, 0.25],
        [0.75, 0.75],
      ] as Samples,
    };
    const preview = await renderOrder({ ...scenario, size: 180 });
    const exported = await renderOrder({ ...scenario, size: 720 });
    expectColors(preview, [RED, MAGENTA, MAGENTA]);
    expectColors(exported, preview);
  });
});

// The rows of the open Layers menu.
function layerMenuRows() {
  return page.getByRole("menu").getByRole("menuitemcheckbox");
}

describe("Order on an FX clip", { timeout: 60_000 }, () => {
  test("an FX clip's add menu offers Order", async () => {
    const { project, clipId } = await insertClip(
      EMPTY_PROJECT,
      "fx",
      "1",
      1,
      5,
    );
    let edited = project;
    await render(
      <FxClipEditor
        project={project}
        selection={{ clipId }}
        onChange={(history) => {
          edited = history.present;
        }}
      />,
    );
    await addFromMenu("Add device to this clip", "Transform", /^Order /);

    const label = () =>
      document.querySelector(
        '[data-timeline-lane-id="1"] .clip-card--fx strong',
      )?.textContent;
    await expect.poll(label).toBe("FX · Order");
    expect(describeFxClip(edited.effects, clipId)).toBe("FX · Order");
    const added = edited.effects.find(
      (each) => each.trackId === `clip:${clipId}`,
    );
    expect(isOrderEffectName(added?.effectName ?? "")).toBe(true);
  });

  // An Order on an FX clip only arranges the layers beneath it, so its
  // Layers menu lists only those; the Global Order's menu lists every layer.
  test("an FX clip's Order lists only the layers beneath it", async () => {
    // Layer 2 of three layers.
    const layers = withLayersBelow(EMPTY_PROJECT, 2);
    expect(layers.lanes.map((lane) => lane.id)).toEqual(["1", "2", "3"]);
    const { project, clipId } = await insertClip(layers, "fx", "2", 1, 5);
    await render(<FxClipEditor project={project} selection={{ clipId }} />);
    expect(
      document.querySelectorAll('[data-timeline-lane-id="2"] .clip-card--fx'),
    ).toHaveLength(1);

    await addFromMenu("Add device to this clip", "Transform", /^Order /);

    const clipOrder = page.elementLocator(
      document.querySelector(
        '.fx-chain :is(section[data-fx-group="clip"], [data-fx-group="clip"] > section)[aria-label="Order"]',
      ) ?? missing("clip Order"),
    );
    await userEvent.click(
      page.elementLocator(
        clipOrder.element().querySelector(".fx-layers__trigger") ??
          missing("clip Order's Layers menu"),
      ),
    );
    await expect
      .poll(() =>
        layerMenuRows()
          .elements()
          .map((row) => row.textContent),
      )
      .toEqual(["3Layer 3"]);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => layerMenuRows().elements()).toHaveLength(0);

    const globalOrder = [
      ...document.querySelectorAll<HTMLElement>('section[aria-label="Order"]'),
    ].find((section) => !section.textContent?.includes("Arranges the layers"));
    await userEvent.click(
      page.elementLocator(
        globalOrder?.querySelector(".fx-layers__trigger") ??
          missing("Global Order's Layers menu"),
      ),
    );
    await expect
      .poll(() =>
        layerMenuRows()
          .elements()
          .map((row) => row.textContent),
      )
      .toEqual(["1Layer 1", "2Layer 2", "3Layer 3"]);
  });
});

function missing(name: string): never {
  throw new Error(`No ${name}`);
}
