import { expect, type Locator, type Page, test } from "@playwright/test";

// Distortion is added to a layer from Video → Stylize with its defaults and
// warps the preview; rendered straight through the effect chain, Amount 0
// leaves every type's picture as is and Transparent edges clear what falls
// outside the source.

function lane(page: Page, id: string) {
  return page.locator(`[data-timeline-lane-id="${id}"]`);
}

// Inserts a fill clip on layer `laneId`, selected, and moves the playhead
// to its middle, where it is fully drawn.
async function insertFillAtStart(page: Page, laneId: string) {
  const bounds = await lane(page, laneId).boundingBox();
  if (!bounds) {
    throw new Error("Lane is not visible");
  }
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 150, y);
  await page.mouse.move(bounds.x + 260, y);
  await page.mouse.up();
  await page.mouse.click(bounds.x + 150, y, { button: "right" });
  await page
    .getByRole("menu", { name: "Selection actions" })
    .getByRole("menuitem", { name: "Insert Fill Clip" })
    .click();
  const fill = lane(page, laneId).locator(".clip-card--fill");
  await expect(fill).toHaveClass(/clip-card--selected/);
  const clip = await fill.boundingBox();
  const ruler = await page.locator(".ruler-row").boundingBox();
  if (!clip || !ruler) {
    throw new Error("The clip or ruler is not visible");
  }
  await page.mouse.click(clip.x + clip.width / 2, ruler.y + ruler.height / 2);
  await expect(fill).toHaveClass(/clip-card--selected/);
}

// The preview scaled down to 64 × 64, as RGB values, read from a screenshot
// so the WebGL canvas needn't keep its drawing buffer.
async function previewPixels(page: Page) {
  await page.mouse.move(0, 0);
  const png = await page
    .locator(".composition-player__canvas")
    .screenshot({ animations: "disabled" });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D context");
    context.drawImage(image, 0, 0, 64, 64);
    return Array.from(context.getImageData(0, 0, 64, 64).data).filter(
      (_, index) => index % 4 !== 3,
    );
  }, png.toString("base64"));
}

// The largest per-channel difference between two samples, 0-255.
function difference(left: ArrayLike<number>, right: ArrayLike<number>) {
  let most = 0;
  for (let index = 0; index < left.length; index++) {
    most = Math.max(most, Math.abs(left[index] - right[index]));
  }
  return most;
}

async function typeValue(device: Locator, label: string, value: string) {
  // A knob's readout opens its editor on a double-click.
  await device
    .getByRole("button", { name: new RegExp(`^${label}: `) })
    .dblclick();
  const input = device.getByRole("textbox", { name: `${label} value` });
  await input.fill(value);
  await input.press("Enter");
}

test("Distortion is added to a layer from Video → Stylize with its defaults and warps the preview", async ({
  page,
}) => {
  await page.goto("/");
  await insertFillAtStart(page, "1");
  // A gradient, which a warp visibly moves.
  await page
    .locator('section[aria-label="Color"]')
    .getByRole("button", { name: "Gradient" })
    .click();
  const plain = await previewPixels(page);

  await page.getByRole("button", { name: "Add device to this layer" }).click();
  await page
    .getByRole("menu")
    .first()
    .getByRole("group", { name: "Video" })
    .getByRole("menuitem", { name: "Stylize" })
    .press("ArrowRight");
  await page
    .getByRole("menu")
    .last()
    .getByRole("menuitem", { name: /^Distortion/ })
    .click();
  const device = page.locator(
    `.fx-chain :is(section[data-fx-group="layer"], [data-fx-group="layer"] > section)[aria-label="Distortion"]`,
  );
  await expect(device).toHaveCount(1);

  await expect(device.getByRole("combobox", { name: "Type" })).toHaveText(
    /Wave/,
  );
  const edges = device.getByRole("group", { name: "Edges" });
  await expect(edges.getByRole("button", { name: "Clamp" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const [label, value] of [
    ["Amount", "+30%"],
    ["Size", "50%"],
    ["Speed", "0%"],
    ["Angle", "0°"],
  ]) {
    await expect(device.getByRole("slider", { name: label })).toHaveAttribute(
      "aria-valuetext",
      value,
    );
  }
  // Angle is Wave's alone; the center belongs to the centered types.
  await expect(device.getByRole("slider", { name: "Center X" })).toHaveCount(0);
  await expect(device.getByRole("slider", { name: "Center Y" })).toHaveCount(0);
  await expect(
    device.getByRole("button", { name: /Turn Animation/ }),
  ).toHaveCount(1);

  await device.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Twirl", exact: true }).click();
  await expect(device.getByRole("combobox", { name: "Type" })).toHaveText(
    /Twirl/,
  );
  await expect(device.getByRole("slider", { name: "Angle" })).toHaveCount(0);
  await expect(
    device.getByRole("slider", { name: "Center X" }),
  ).toHaveAttribute("aria-valuetext", "50%");

  // A full twirl over the whole frame turns the gradient; Amount 0 puts it
  // back.
  await typeValue(device, "Size", "100");
  await typeValue(device, "Amount", "100");
  await expect
    .poll(async () => difference(await previewPixels(page), plain), {
      timeout: 15_000,
    })
    .toBeGreaterThan(16);
  await typeValue(device, "Amount", "0");
  await expect
    .poll(async () => difference(await previewPixels(page), plain), {
      timeout: 15_000,
    })
    .toBeLessThan(4);
});

type Render = { rgba: Buffer; width: number };

// Renders a 320 × 180 synthetic frame through Distortion with each set of
// `values` on the effect chain the preview uses. The shader always runs,
// even where the chain would skip it as changing nothing. Returns the
// source frame first, then each run's RGBA pixels, bottom row first.
async function renderDistortion(
  page: Page,
  runs: { values: Record<string, string | number>; time?: number }[],
) {
  const renders = await page.evaluate(async (runs) => {
    // Variables, so the type checker doesn't resolve the dev server paths.
    const chainPath = "/src/fx-shaders/chain.ts";
    const passPath = "/src/fx/effects/distortion/pass.ts";
    const { EffectChainRenderer, wholeTexture } = await import(chainPath);
    const { pass: distortion } = await import(passPath);
    const pass = { ...distortion, isIdentity: undefined };

    const width = 320;
    const height = 180;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      antialias: false,
    }) as WebGLRenderingContext;

    // Color ramps crossed with a checkerboard, all opaque.
    const source = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const check = (Math.floor(x / 20) + Math.floor(y / 20)) % 2;
        source[index] = Math.round((x / (width - 1)) * 255);
        source[index + 1] = Math.round((y / (height - 1)) * 255);
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
      width,
      height,
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
    renderer.syncSurface(width, height);

    // Base64, which crosses back to the test far faster than an array.
    const encode = (bytes: Uint8Array) => {
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      return btoa(binary);
    };
    const renders = [encode(source)];
    for (const { values, time } of runs) {
      const parameters = Object.entries(values).map(([key, value]) =>
        typeof value === "number"
          ? { key, value: String(value), numericValue: value }
          : { key, value },
      );
      const steps = renderer.prepare([{ pass, parameters }]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.run(
        wholeTexture(texture),
        width,
        height,
        steps,
        {
          time: time ?? 2.5,
          clipProgress: 0.5,
          resolution: [width, height],
          bottomUp: true,
        },
        "screen",
      );
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      renders.push(encode(pixels));
    }
    return renders;
  }, runs);
  return renders.map(
    (data): Render => ({ rgba: Buffer.from(data, "base64"), width: 320 }),
  );
}

function maxDifference(left: Render, right: Render) {
  return difference(left.rgba, right.rgba);
}

function alphaAt(render: Render, x: number, y: number) {
  return render.rgba[(y * render.width + x) * 4 + 3];
}

const TYPES = ["Wave", "Ripple", "Twirl", "Bulge", "Fisheye", "Turbulence"];

test("Distortion leaves the picture as is at Amount 0 and warps it otherwise, for every type", async ({
  page,
}) => {
  await page.goto("/export-smoke.html");
  const runs = TYPES.flatMap((type) => [
    ...["Clamp", "Mirror", "Transparent"].map((edges) => ({
      values: { _Type: type, _Edges: edges, _Amount: 0, _Speed: 1 },
    })),
    { values: { _Type: type, _Amount: 0.5, _Size: 0.3 } },
    { values: { _Type: type, _Amount: -0.5, _Size: 0.3 } },
  ]);
  const [source, ...renders] = await renderDistortion(page, runs);
  for (const [index, type] of TYPES.entries()) {
    const [clamp, mirror, transparent, positive, negative] = renders.slice(
      index * 5,
      index * 5 + 5,
    );
    expect(maxDifference(clamp, source), `${type} Clamp`).toBe(0);
    expect(maxDifference(mirror, source), `${type} Mirror`).toBe(0);
    expect(maxDifference(transparent, source), `${type} Transparent`).toBe(0);
    expect(maxDifference(positive, source), `${type} +50%`).toBeGreaterThan(32);
    expect(maxDifference(negative, positive), `${type} -50%`).toBeGreaterThan(
      32,
    );
  }
});

test("Distortion's Transparent edges clear what falls outside the source", async ({
  page,
}) => {
  await page.goto("/export-smoke.html");
  // A full pinch pulls the frame's corners in from outside it.
  const pinch = { _Type: "Bulge", _Amount: -1, _Size: 1 };
  const [, clamp, mirror, transparent] = await renderDistortion(page, [
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

test("Distortion renders the same frame at the same time and moves with Speed", async ({
  page,
}) => {
  await page.goto("/export-smoke.html");
  const wave = { _Type: "Wave", _Amount: 0.6, _Size: 0.3, _Speed: 0.4 };
  const [, first, again, later, still, stillLater] = await renderDistortion(
    page,
    [
      { values: wave, time: 3.3 },
      { values: wave, time: 3.3 },
      { values: wave, time: 3.5 },
      { values: { ...wave, _Speed: 0 }, time: 3.3 },
      { values: { ...wave, _Speed: 0 }, time: 9.1 },
    ],
  );
  expect(maxDifference(first, again)).toBe(0);
  expect(maxDifference(first, later)).toBeGreaterThan(16);
  expect(maxDifference(still, stillLater)).toBe(0);
});
