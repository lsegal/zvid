// dotLottie (`.lottie`) files: zip archives holding a `manifest.json`, one or
// more Lottie animations and their images. Version 1 keeps them under
// `animations/` and `images/`, version 2 under `a/` and `i/`. The animation
// the manifest names first plays, with its images inlined as data URLs.

import { asLottieData, type LottieData } from "./lottie.ts";
import { readZip, type ZipArchive } from "./zip.ts";

const ANIMATION_FOLDERS = ["animations/", "a/"];
const IMAGE_FOLDERS = ["images/", "i/"];

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export type LottieFile = { data: LottieData } | { error: string };

type LottieAsset = { u?: unknown; p?: unknown; e?: unknown };

/** Whether the file `name` is a dotLottie archive. */
export function isDotLottieName(name: string) {
  return name.toLowerCase().endsWith(".lottie");
}

async function readJson(archive: ZipArchive, name: string) {
  const bytes = await archive.read(name);
  try {
    return bytes
      ? (JSON.parse(new TextDecoder().decode(bytes)) as unknown)
      : undefined;
  } catch {
    return undefined;
  }
}

// The animation files of `archive`, those the manifest lists first, in its
// order, then any others.
async function animationNames(archive: ZipArchive) {
  const manifest = (await readJson(archive, "manifest.json")) as
    | { animations?: unknown }
    | undefined;
  const listed = Array.isArray(manifest?.animations)
    ? manifest.animations.flatMap((animation: { id?: unknown }) =>
        typeof animation?.id === "string"
          ? ANIMATION_FOLDERS.map((folder) => `${folder}${animation.id}.json`)
          : [],
      )
    : [];
  const stored = archive.names.filter(
    (name) =>
      ANIMATION_FOLDERS.some((folder) => name.startsWith(folder)) &&
      name.toLowerCase().endsWith(".json"),
  );
  return [...new Set([...listed, ...stored])].filter((name) =>
    archive.names.includes(name),
  );
}

function base64(bytes: Uint8Array) {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

// The archive file holding `asset`'s image: its own path, or its file name
// in an image folder.
function assetName(archive: ZipArchive, asset: LottieAsset) {
  if (typeof asset.p !== "string") {
    return undefined;
  }
  const folder = typeof asset.u === "string" ? asset.u : "";
  return [
    `${folder}${asset.p}`.replace(/^\/+/, ""),
    ...IMAGE_FOLDERS.map((imageFolder) => `${imageFolder}${asset.p}`),
  ].find((name) => archive.names.includes(name));
}

// Inlines each of `data`'s images stored in `archive`, so the player loads
// them without the archive.
async function inlineImages(archive: ZipArchive, data: LottieData) {
  const assets = (data as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) {
    return data;
  }
  const inlined = await Promise.all(
    assets.map(async (asset: LottieAsset) => {
      const name =
        asset && typeof asset === "object" && asset.e !== 1
          ? assetName(archive, asset)
          : undefined;
      const type = IMAGE_TYPES[name?.split(".").pop()?.toLowerCase() ?? ""];
      const bytes = name && type ? await archive.read(name) : undefined;
      return bytes
        ? { ...asset, u: "", p: `data:${type};base64,${base64(bytes)}`, e: 1 }
        : asset;
    }),
  );
  return { ...data, assets: inlined };
}

/** The animation the dotLottie archive `bytes` plays first, or why not. */
export async function readDotLottie(bytes: Uint8Array): Promise<LottieFile> {
  const archive = readZip(bytes);
  if (!archive) {
    return { error: "Not a dotLottie archive" };
  }
  for (const name of await animationNames(archive)) {
    const data = asLottieData(await readJson(archive, name));
    if (data) {
      return { data: await inlineImages(archive, data) };
    }
  }
  return { error: "No animation in the dotLottie archive" };
}
