import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";

// The installers ship the Tauri app, whose icon comes from bundle.icon: the
// .icns becomes zvid.app's icon on macOS and the .ico is embedded in the
// Windows executable, which the Start menu shortcut and Settings › Apps entry
// show.
function readAppFile(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url));
}

const bundleIcons = (
  JSON.parse(readAppFile("src-tauri/tauri.conf.json").toString("utf8")) as {
    bundle: { icon?: string[] };
  }
).bundle.icon;

function bundleIcon(extension: string) {
  const path = bundleIcons?.find((icon) => icon.endsWith(extension));
  assert.ok(path, `bundle.icon lists no ${extension}`);
  return readAppFile(`src-tauri/${path}`);
}

const pathData = (source: string) =>
  [...source.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(([, d]) =>
    d.split(/\s+/).join(" ").trim(),
  );

// Decodes an 8-bit, non-interlaced RGBA PNG into rows of pixels.
function decodePng(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.deepEqual([png[24], png[25], png[28]], [8, 6, 0], "not 8-bit RGBA");
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("latin1", offset + 4, offset + 8) === "IDAT") {
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const data = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    const row = Buffer.from(
      data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    const above = rows[y - 1] ?? Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0;
      const upperLeft = x >= 4 ? above[x - 4] : 0;
      const predictor = [
        0,
        left,
        above[x],
        (left + above[x]) >> 1,
        paeth(left, above[x], upperLeft),
      ][filter];
      row[x] = (row[x] + predictor) & 0xff;
    }
    rows.push(row);
  }
  return (x: number, y: number) => [...rows[y].subarray(x * 4, x * 4 + 4)];
}

function paeth(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const [a, b, c] = [left, above, upperLeft].map((value) =>
    Math.abs(estimate - value),
  );
  return a <= b && a <= c ? left : b <= c ? above : upperLeft;
}

describe("desktop app icons", () => {
  it("lists icon files that exist", () => {
    assert.ok(bundleIcons?.length, "bundle.icon is empty");
    for (const icon of bundleIcons) {
      assert.ok(readAppFile(`src-tauri/${icon}`).length > 0, icon);
    }
  });

  it("has a multi-size Windows .ico", () => {
    const ico = bundleIcon(".ico");
    const count = ico.readUInt16LE(4);
    // A width byte of 0 means 256 pixels.
    const sizes = Array.from(
      { length: count },
      (_, index) => ico[6 + index * 16] || 256,
    );
    for (const size of [16, 32, 48, 256]) {
      assert.ok(sizes.includes(size), `icon.ico lacks ${size}px: ${sizes}`);
    }
  });

  it("has a macOS .icns up to 1024px", () => {
    const icns = bundleIcon(".icns");
    assert.equal(icns.toString("latin1", 0, 4), "icns");
    const types: string[] = [];
    for (let offset = 8; offset < icns.length; ) {
      types.push(icns.toString("latin1", offset, offset + 4));
      offset += icns.readUInt32BE(offset + 4);
    }
    // ic07 is 128px, ic09 512px and ic10 the 1024px (512@2x) image.
    for (const type of ["ic07", "ic09", "ic10"]) {
      assert.ok(types.includes(type), `icon.icns lacks ${type}: ${types}`);
    }
  });

  it("draws the white zvid logo on the favicon's purple", () => {
    const source = readAppFile("src-tauri/icons/app-icon.svg").toString("utf8");
    const favicon = readAppFile("public/favicon.svg").toString("utf8");
    assert.doesNotMatch(source, /<circle/);
    assert.equal(pathData(source).length, 3);
    assert.deepEqual(pathData(source), pathData(favicon));
    assert.match(source, /<rect\b[^>]*fill="#863bff"/);
    assert.match(source, /<g fill="#fff"/);
  });

  it("rasterized the current icon source", () => {
    // 128x128@2x.png is the 256px image; app-icon.svg maps to it at 1/4 scale.
    const pixel = decodePng(
      readAppFile("src-tauri/icons/128x128@2x.png") as Buffer,
    );
    const purple = [0x86, 0x3b, 0xff, 255];
    const white = [255, 255, 255, 255];
    // Outside the 64px inset, the panel, the Z's diagonal, and a sprocket hole.
    assert.equal(pixel(4, 128)[3], 0);
    assert.deepEqual(pixel(24, 128), purple);
    assert.deepEqual(pixel(122, 128), white);
    assert.deepEqual(pixel(134, 88), purple);
  });
});
