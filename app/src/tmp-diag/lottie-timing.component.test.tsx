import { test } from "vitest";
import { lottieFrameUrl, openLottie } from "../lottie-player.ts";

function lottieJson() {
  const still = (k: unknown) => ({ a: 0, k });
  const solid = (ind: number, sc: string, ip: number, op: number) => ({
    ddd: 0, ind, ty: 1, nm: sc, sc, sw: 64, sh: 64, ip, op, st: 0, sr: 1, bm: 0,
    ks: { o: still(100), r: still(0), p: still([0, 0, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]) },
  });
  return JSON.stringify({ v: "5.7.0", fr: 30, ip: 0, op: 30, w: 64, h: 64, nm: "x", ddd: 0, assets: [],
    layers: [solid(1, "#ff0000", 0, 15), solid(2, "#0000ff", 15, 30)] });
}

async function blobOf(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
}

test("DIAG lottie timing", async () => {
  const out: string[] = [];
  for (let round = 0; round < 3; round++) {
    const url = URL.createObjectURL(new Blob([lottieJson()], { type: "application/json" }));
    let t = performance.now();
    const lap = (label: string) => {
      const now = performance.now();
      out.push(`DIAG r${round} ${label}: ${(now - t).toFixed(1)} ms`);
      t = now;
    };
    const player = await openLottie(url, "x.json");
    lap("openLottie");
    const canvas = player.frame(15);
    lap(`frame ${canvas.width}x${canvas.height}`);
    const blob = await blobOf(canvas);
    lap(`toBlob ${blob?.size}`);
    await lottieFrameUrl(player, 20);
    lap("lottieFrameUrl other frame");
    const small = document.createElement("canvas");
    small.width = 160; small.height = 160;
    small.getContext("2d")?.drawImage(canvas, 0, 0, 160, 160);
    lap("downscale 160");
    const sb = await blobOf(small);
    lap(`small toBlob ${sb?.size}`);
    const raf = await new Promise<number>((r) => { const s = performance.now(); requestAnimationFrame(() => r(performance.now() - s)); });
    out.push(`DIAG r${round} raf ${raf.toFixed(1)}`);
  }
  throw new Error(out.join("\n"));
});
