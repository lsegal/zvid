import { afterAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ProjectState } from "../../../app/types.ts";
import { getSwatch } from "../../../app/util.ts";
import { device, typeValue } from "../../../component-test/fx-actions.ts";
import { FxEditor } from "../../../component-test/fx-editor.tsx";
import {
  maxDifference,
  parameters,
  scaledRgb,
  stackDevice,
} from "../../../component-test/fx-frames.ts";
import {
  EMPTY_PROJECT,
  withFillClip,
} from "../../../component-test/fx-projects.ts";
import {
  rendererState,
  renderFrame,
} from "../../../component-test/fx-render.ts";
import { getDefaultFillColor } from "../../../fill-clip.ts";
import {
  EffectChainRenderer,
  wholeTexture,
} from "../../../fx-shaders/chain.ts";
import { pass as distortion } from "./pass.ts";

// Distortion is added to a layer from Video → Distort with its defaults and
// warps the preview; rendered straight through the effect chain, Amount 0
// leaves every type's picture as is and Transparent edges clear what falls
// outside the source.

const PREVIEW = { width: 320, height: 180 };

describe("Distortion", { timeout: 60_000 }, () => {
  test("is added to a layer from Video → Distort with its defaults and warps the preview", async () => {
    // A fill clip on layer 1, as Insert Fill Clip makes it, selected and
    // previewed in its middle.
    const fill = withFillClip(
      EMPTY_PROJECT,
      getDefaultFillColor(getSwatch(EMPTY_PROJECT.lanes[0].colorIndex).accent),
    );
    let project: ProjectState = fill.project;
    // The preview scaled down to 64 × 64, as RGB values.
    const preview = async () =>
      scaledRgb(await renderFrame(rendererState(project, PREVIEW), 4), 64);

    await render(
      <FxEditor
        project={project}
        selection={{ clipId: fill.clip.id }}
        onChange={(history) => {
          project = history.present;
        }}
      />,
    );
    // A gradient, which a warp visibly moves.
    await userEvent.click(
      device("Color").getByRole("button", { name: "Gradient" }),
    );
    const plain = await preview();

    await userEvent.click(
      page.getByRole("button", { name: "Add device to this layer" }),
    );
    page
      .getByRole("menu")
      .first()
      .getByRole("group", { name: "Video" })
      .getByRole("menuitem", { name: "Distort", exact: true })
      .element()
      .focus();
    await userEvent.keyboard("{ArrowRight}");
    // The Distort submenu's, not the audio Distortion beside it.
    await userEvent.click(
      page
        .getByRole("menu")
        .last()
        .getByRole("menuitem", { name: /^Distortion/ }),
    );
    const panel = stackDevice("Distortion", "layer");

    await expect
      .element(panel.getByRole("combobox", { name: "Type" }))
      .toHaveTextContent("Wave");
    const edges = panel.getByRole("group", { name: "Edges" });
    await expect
      .element(edges.getByRole("button", { name: "Clamp" }))
      .toHaveAttribute("aria-pressed", "true");
    for (const [label, value] of [
      ["Amount", "+30%"],
      ["Size", "50%"],
      ["Speed", "0%"],
      ["Angle", "0°"],
    ]) {
      await expect
        .element(panel.getByRole("slider", { name: label }))
        .toHaveAttribute("aria-valuetext", value);
    }
    // Angle is Wave's alone; the center belongs to the centered types.
    expect(
      panel.getByRole("slider", { name: "Center X" }).elements(),
    ).toHaveLength(0);
    expect(
      panel.getByRole("slider", { name: "Center Y" }).elements(),
    ).toHaveLength(0);
    expect(
      panel.getByRole("button", { name: /Turn Animation/ }).elements(),
    ).toHaveLength(1);

    await userEvent.click(panel.getByRole("combobox", { name: "Type" }));
    await userEvent.click(
      page.getByRole("option", { name: "Twirl", exact: true }),
    );
    await expect
      .element(panel.getByRole("combobox", { name: "Type" }))
      .toHaveTextContent("Twirl");
    await expect
      .element(panel.getByRole("slider", { name: "Angle" }))
      .not.toBeInTheDocument();
    await expect
      .element(panel.getByRole("slider", { name: "Center X" }))
      .toHaveAttribute("aria-valuetext", "50%");

    // A full twirl over the whole frame turns the gradient; Amount 0 puts it
    // back.
    await typeValue(panel, "Size", "100");
    await typeValue(panel, "Amount", "100");
    await expect
      .element(panel.getByRole("slider", { name: "Amount" }))
      .toHaveAttribute("aria-valuetext", "+100%");
    expect(maxDifference(await preview(), plain)).toBeGreaterThan(16);
    await typeValue(panel, "Amount", "0");
    await expect
      .element(panel.getByRole("slider", { name: "Amount" }))
      .toHaveAttribute("aria-valuetext", "0%");
    expect(maxDifference(await preview(), plain)).toBeLessThan(4);
  });
});

const WIDTH = 320;
const HEIGHT = 180;

type Render = { rgba: Uint8Array; width: number };

// The effect chain the preview uses, on its own canvas holding the source
// frame: color ramps crossed with a checkerboard, all opaque. One serves
// every render in this file.
type Chain = {
  gl: WebGLRenderingContext;
  renderer: EffectChainRenderer;
  texture: WebGLTexture;
  source: Uint8Array;
};
let chain: Chain | undefined;

afterAll(() => {
  chain?.renderer.dispose();
  chain?.gl.getExtension("WEBGL_lose_context")?.loseContext();
  chain = undefined;
});

function sourceChain(): Chain {
  if (chain) return chain;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext("webgl", {
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    antialias: false,
  });
  if (!gl) throw new Error("WebGL is unavailable.");

  const source = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const index = (y * WIDTH + x) * 4;
      const check = (Math.floor(x / 20) + Math.floor(y / 20)) % 2;
      source[index] = Math.round((x / (WIDTH - 1)) * 255);
      source[index + 1] = Math.round((y / (HEIGHT - 1)) * 255);
      source[index + 2] = check * 255;
      source[index + 3] = 255;
    }
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    WIDTH,
    HEIGHT,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    source,
  );
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const renderer = new EffectChainRenderer(gl, quad);
  renderer.exactTargets = true;
  renderer.syncSurface(WIDTH, HEIGHT);
  chain = { gl, renderer, texture, source };
  return chain;
}

// Renders the WIDTH × HEIGHT source frame through Distortion with each set
// of `values`. The shader always runs, even where the chain would skip it
// as changing nothing. Returns the source frame first, then each run's RGBA
// pixels, bottom row first.
function renderDistortion(
  runs: { values: Record<string, string | number>; time?: number }[],
): Render[] {
  const { gl, renderer, texture, source } = sourceChain();
  const renders: Render[] = [{ rgba: source, width: WIDTH }];
  for (const { values, time } of runs) {
    const steps = renderer.prepare([{ pass, parameters: parameters(values) }]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.run(
      wholeTexture(texture),
      WIDTH,
      HEIGHT,
      steps,
      {
        time: time ?? 2.5,
        clipProgress: 0.5,
        resolution: [WIDTH, HEIGHT],
        bottomUp: true,
      },
      "screen",
    );
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    renders.push({ rgba: pixels, width: WIDTH });
  }
  return renders;
}

function difference(left: Render, right: Render) {
  return maxDifference(left.rgba, right.rgba);
}

function alphaAt(render: Render, x: number, y: number) {
  return render.rgba[(y * render.width + x) * 4 + 3];
}

// Distortion without its identity check, so it always runs.
const pass = { ...distortion, isIdentity: undefined };

const TYPES = ["Wave", "Ripple", "Twirl", "Bulge", "Fisheye", "Turbulence"];

describe("Distortion rendering", { timeout: 60_000 }, () => {
  test("leaves the picture as is at Amount 0 and warps it otherwise, for every type", () => {
    const runs = TYPES.flatMap((type) => [
      ...["Clamp", "Mirror", "Transparent"].map((edges) => ({
        values: { _Type: type, _Edges: edges, _Amount: 0, _Speed: 1 },
      })),
      { values: { _Type: type, _Amount: 0.5, _Size: 0.3 } },
      { values: { _Type: type, _Amount: -0.5, _Size: 0.3 } },
    ]);
    const [source, ...renders] = renderDistortion(runs);
    for (const [index, type] of TYPES.entries()) {
      const [clamp, mirror, transparent, positive, negative] = renders.slice(
        index * 5,
        index * 5 + 5,
      );
      expect(difference(clamp, source), `${type} Clamp`).toBe(0);
      expect(difference(mirror, source), `${type} Mirror`).toBe(0);
      expect(difference(transparent, source), `${type} Transparent`).toBe(0);
      expect(difference(positive, source), `${type} +50%`).toBeGreaterThan(32);
      expect(difference(negative, positive), `${type} -50%`).toBeGreaterThan(
        32,
      );
    }
  });

  test("Transparent edges clear what falls outside the source", () => {
    // A full pinch pulls the frame's corners in from outside it.
    const pinch = { _Type: "Bulge", _Amount: -1, _Size: 1 };
    const [, clamp, mirror, transparent] = renderDistortion([
      { values: { ...pinch, _Edges: "Clamp" } },
      { values: { ...pinch, _Edges: "Mirror" } },
      { values: { ...pinch, _Edges: "Transparent" } },
    ]);
    for (const render of [clamp, mirror]) {
      expect(
        render.rgba.every((value, index) => index % 4 !== 3 || value === 255),
      ).toBe(true);
    }
    // The middles of the top and bottom edges sample outside the frame; the
    // center and the corners, beyond the pinch, stay put.
    for (const [x, y] of [
      [160, 0],
      [160, 179],
    ]) {
      expect(alphaAt(transparent, x, y), `${x},${y}`).toBe(0);
    }
    for (const [x, y] of [
      [160, 90],
      [0, 0],
      [319, 179],
    ]) {
      expect(alphaAt(transparent, x, y), `${x},${y}`).toBe(255);
    }
    // A cleared pixel is cleared through, color and all.
    let tinted = 0;
    for (let index = 0; index < transparent.rgba.length; index += 4) {
      if (transparent.rgba[index + 3] === 0) {
        tinted += transparent.rgba[index] + transparent.rgba[index + 1];
      }
    }
    expect(tinted).toBe(0);
  });

  test("renders the same frame at the same time and moves with Speed", () => {
    const wave = { _Type: "Wave", _Amount: 0.6, _Size: 0.3, _Speed: 0.4 };
    const [, first, again, later, still, stillLater] = renderDistortion([
      { values: wave, time: 3.3 },
      { values: wave, time: 3.3 },
      { values: wave, time: 3.5 },
      { values: { ...wave, _Speed: 0 }, time: 3.3 },
      { values: { ...wave, _Speed: 0 }, time: 9.1 },
    ]);
    expect(difference(first, again)).toBe(0);
    expect(difference(first, later)).toBeGreaterThan(16);
    expect(difference(still, stillLater)).toBe(0);
  });
});
