import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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
});
