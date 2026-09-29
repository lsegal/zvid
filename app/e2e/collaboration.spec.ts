import { readFile } from "node:fs/promises";
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { startSignalingServer } from "./signaling-server.ts";

// Sharing between two browser contexts: separate storage, so no
// BroadcastChannel shortcut between them, and everything has to go through
// the signaling server and WebRTC, like two different browsers.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

// Chromium hides host ICE candidates behind mDNS names by default, which
// headless CI can't resolve; the contexts share a machine, so plain host
// candidates are enough to connect them.
test.use({
  launchOptions: {
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  },
});

let signaling: Awaited<ReturnType<typeof startSignalingServer>>;
const contexts: BrowserContext[] = [];

test.beforeAll(async () => {
  signaling = await startSignalingServer();
});

test.afterAll(async () => {
  await signaling.close();
});

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

async function openApp(browser: Browser, path = "/") {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  contexts.push(context);
  // Point the app's signaling setting at the local server.
  await context.addInitScript((url) => {
    window.localStorage.setItem(
      "zvid-collaboration",
      JSON.stringify({ signaling: url }),
    );
  }, signaling.url);
  const page = await context.newPage();
  await page.goto(path);
  await expect(layerNames(page).first()).toBeVisible();
  return page;
}

function layerNames(page: Page) {
  return page.locator("[data-layer-header-id] .track-label__select > span");
}

function connectionStatus(page: Page) {
  return page.locator(".collaboration-status");
}

async function renameLayer(page: Page, id: string, name: string) {
  const header = page.locator(`[data-layer-header-id="${id}"]`);
  await header.scrollIntoViewIfNeeded();
  await header.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Layer name" });
  await input.fill(name);
  await input.press("Enter");
}

async function dropVideo(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
  // Ctrl/Cmd+click places the source clip on the timeline.
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
}

async function startSharing(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Start Sharing" }).click();
  await expect(connectionStatus(page)).toHaveText("Sharing, waiting for peer", {
    timeout: 15_000,
  });
  const invite = await page.evaluate(() => navigator.clipboard.readText());
  // Join through the test server's origin, whatever host the invite names.
  const url = new URL(invite);
  return `${url.pathname}${url.search}${url.hash}`;
}

test("a guest in another browser context joins, syncs both ways and receives media", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const host = await openApp(browser);
  await renameLayer(host, "5", "Host layer");
  await dropVideo(host);
  const invitePath = await startSharing(host);

  const guest = await openApp(browser, invitePath);
  let mediaReceived = 0;
  guest.on("console", async (message) => {
    if (message.text().includes("collaboration:media:request:end")) {
      const payload = await message.args()[1]?.jsonValue();
      mediaReceived = Math.max(mediaReceived, payload?.size ?? 0);
    }
  });
  await expect(connectionStatus(guest)).toHaveText("1 peer connected", {
    timeout: 30_000,
  });
  await expect(connectionStatus(host)).toHaveText("1 peer connected");

  // The guest adopts the host's project instead of publishing its own.
  await expect(layerNames(guest)).toHaveText([
    "Layer 1",
    "Host layer",
    "Layer 3",
  ]);
  await expect(guest.locator(".source-span")).toHaveCount(1);
  await expect(guest.locator(".clip-card")).toHaveCount(1);

  // Edits sync both ways.
  await renameLayer(guest, "6", "Guest layer");
  await expect(layerNames(host)).toHaveText([
    "Layer 1",
    "Host layer",
    "Guest layer",
  ]);
  await renameLayer(host, "1", "Host again");
  await expect(layerNames(guest)).toHaveText([
    "Host again",
    "Host layer",
    "Guest layer",
  ]);

  // The guest doesn't have the host's video file, so it streams over WebRTC.
  await expect
    .poll(() => mediaReceived, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await expect(guest.locator(".track-label__offline")).toHaveCount(0);

  // The diagnostics show a real WebRTC peer, not a same-browser tab.
  await connectionStatus(guest).click();
  const diagnostics = guest.getByRole("dialog", {
    name: "Connection diagnostics",
  });
  await expect(diagnostics).toContainText(`Signaling ${signaling.url}`);
  await expect(diagnostics).toContainText("Peers connected (WebRTC)1");
  await expect(diagnostics).toContainText("Received from host");
  await expect(diagnostics).not.toContainText("Same-browser tabs");
});

test("a guest with no host waits, then says the host wasn't found", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const guest = await openApp(
    browser,
    `/?room=nobody-home&signal=${encodeURIComponent(signaling.url)}`,
  );
  await expect(connectionStatus(guest)).toHaveText("Waiting for host...", {
    timeout: 15_000,
  });
  await expect(connectionStatus(guest)).toHaveText(
    "Host not found, check the invite and that the host is sharing",
    { timeout: 30_000 },
  );
  // The guest never publishes its own project into the room.
  await expect(layerNames(guest)).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
});

test("an unreachable signaling server is reported", async ({ browser }) => {
  test.setTimeout(60_000);
  const guest = await openApp(
    browser,
    `/?room=nowhere&signal=${encodeURIComponent("ws://127.0.0.1:9")}`,
  );
  await expect(connectionStatus(guest)).toHaveText(
    "Can't reach the signaling server",
    { timeout: 20_000 },
  );
  await connectionStatus(guest).click();
  await expect(
    guest.getByRole("dialog", { name: "Connection diagnostics" }),
  ).toContainText("Signaling ws://127.0.0.1:9Unreachable");
});
