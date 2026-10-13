import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDotLottieName, readDotLottie } from "./dotlottie.ts";
import { readZip } from "./zip.ts";
import { writeZip } from "./zip-test-utils.ts";

const LOTTIE = { v: "5.7.0", fr: 30, ip: 0, op: 45, w: 64, h: 32, layers: [] };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("zip archives", () => {
  it("read stored and deflated files", async () => {
    const text = "dotLottie ".repeat(50);
    const archive = readZip(
      await writeZip([
        { name: "folder/", data: "" },
        { name: "stored.txt", data: "plain" },
        { name: "folder/deflated.txt", data: text, deflate: true },
      ]),
    );
    assert.deepEqual(archive?.names, ["stored.txt", "folder/deflated.txt"]);
    const decode = (bytes?: Uint8Array) => new TextDecoder().decode(bytes);
    assert.equal(decode(await archive?.read("stored.txt")), "plain");
    assert.equal(decode(await archive?.read("folder/deflated.txt")), text);
    assert.equal(await archive?.read("missing.txt"), undefined);
  });

  it("aren't read from other files", () => {
    assert.equal(readZip(new TextEncoder().encode("not a zip")), undefined);
    assert.equal(readZip(new Uint8Array()), undefined);
  });
});

describe("dotLottie archives", () => {
  it("are read from .lottie files", () => {
    assert.equal(isDotLottieName("Spinner.LOTTIE"), true);
    assert.equal(isDotLottieName("spinner.json"), false);
  });

  it("play the animation the manifest names first", async () => {
    const file = await readDotLottie(
      await writeZip([
        {
          name: "manifest.json",
          data: JSON.stringify({
            animations: [{ id: "second" }, { id: "first" }],
          }),
        },
        {
          name: "animations/first.json",
          data: JSON.stringify({ ...LOTTIE, nm: "first" }),
        },
        {
          name: "animations/second.json",
          data: JSON.stringify({ ...LOTTIE, nm: "second" }),
          deflate: true,
        },
      ]),
    );
    assert.equal("data" in file && (file.data as { nm?: string }).nm, "second");
  });

  it("read version 2 archives and ones without a manifest", async () => {
    const version2 = await readDotLottie(
      await writeZip([
        {
          name: "manifest.json",
          data: JSON.stringify({ version: "2", animations: [{ id: "a1" }] }),
        },
        { name: "a/a1.json", data: JSON.stringify(LOTTIE) },
      ]),
    );
    assert.deepEqual(version2, { data: { ...LOTTIE } });
    const unlisted = await readDotLottie(
      await writeZip([
        { name: "animations/only.json", data: JSON.stringify(LOTTIE) },
      ]),
    );
    assert.deepEqual(unlisted, { data: { ...LOTTIE } });
  });

  it("inline the images the animation uses", async () => {
    const assets = [
      { id: "image_0", w: 8, h: 8, u: "/images/", p: "red.png", e: 0 },
      { id: "image_1", w: 8, h: 8, u: "", p: "blue.png" },
      // Marked embedded, yet naming its file (#1373).
      { id: "image_3", w: 8, h: 8, u: "images/", p: "red.png", e: 1 },
      {
        id: "image_2",
        w: 8,
        h: 8,
        u: "",
        p: "data:image/png;base64,AA==",
        e: 1,
      },
      { id: "missing", w: 8, h: 8, u: "/images/", p: "gone.png" },
      { id: "precomp", layers: [] },
    ];
    const file = await readDotLottie(
      await writeZip([
        {
          name: "manifest.json",
          data: JSON.stringify({ animations: [{ id: "x" }] }),
        },
        {
          name: "animations/x.json",
          data: JSON.stringify({ ...LOTTIE, assets }),
        },
        { name: "images/red.png", data: PNG, deflate: true },
        { name: "images/blue.png", data: PNG },
      ]),
    );
    const inlined = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    assert.deepEqual(
      "data" in file && (file.data as { assets?: unknown }).assets,
      [
        { ...assets[0], u: "", p: inlined, e: 1 },
        { ...assets[1], u: "", p: inlined, e: 1 },
        { ...assets[2], u: "", p: inlined, e: 1 },
        assets[3],
        assets[4],
        assets[5],
      ],
    );
  });

  it("read a plain Lottie JSON file named .lottie", async () => {
    assert.deepEqual(
      await readDotLottie(new TextEncoder().encode(JSON.stringify(LOTTIE))),
      { data: LOTTIE },
    );
  });

  it("say why an archive holds no animation", async () => {
    assert.deepEqual(await readDotLottie(new TextEncoder().encode("{}")), {
      error: "Not a dotLottie archive",
    });
    assert.deepEqual(
      await readDotLottie(
        await writeZip([
          {
            name: "manifest.json",
            data: JSON.stringify({ animations: [{ id: "x" }] }),
          },
          { name: "animations/x.json", data: JSON.stringify({ bpm: 120 }) },
        ]),
      ),
      { error: "No animation in the dotLottie archive" },
    );
  });
});
