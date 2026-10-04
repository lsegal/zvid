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

async function openApp(
  browser: Browser,
  path = "/",
  { blockableServe = false, clock = false } = {},
) {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  contexts.push(context);
  await recordMediaLabels(context);
  if (blockableServe) {
    await blockableMediaServe(context);
  }
  // Point the app's signaling setting at the local server.
  await context.addInitScript((url) => {
    window.localStorage.setItem(
      "zvid-collaboration",
      JSON.stringify({ signaling: url }),
    );
  }, signaling.url);
  const page = await context.newPage();
  // A fake clock lets a test skip the connection timeouts instead of
  // waiting them out; time still runs normally until it fast-forwards.
  if (clock) {
    await page.clock.install();
  }
  await page.goto(path);
  await expect(layerNames(page).first()).toBeVisible();
  return page;
}

function layerNames(page: Page) {
  return page.locator("[data-layer-header-id] .track-label__select > span");
}

// Records every media label the header shows, so a test can check that a
// joiner never reported syncing media as offline.
async function recordMediaLabels(context: BrowserContext) {
  await context.addInitScript(() => {
    const labels: string[] = [];
    Object.assign(window, { __mediaLabels: labels });
    new MutationObserver(() => {
      for (const label of document.querySelectorAll(".track-label__offline")) {
        const text = label.textContent ?? "";
        if (labels.at(-1) !== text) {
          labels.push(text);
        }
      }
    }).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
}

// Lets a test stop a host from serving media: while blocked, reads from the
// media cache (OPFS files, or the IndexedDB blob store without OPFS) find
// nothing and fetches of local blob URLs fail, which are the places the host
// reads a file it sends to a peer.
async function blockableMediaServe(context: BrowserContext) {
  await context.addInitScript(() => {
    const state = { blocked: false };
    Object.assign(window, { __mediaServe: state });
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      // An empty array is a valid key no entry uses.
      return get.call(
        this,
        state.blocked && this.name === "media" ? [] : query,
      );
    };
    if (typeof FileSystemFileHandle !== "undefined") {
      const getFile = FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile = function () {
        return state.blocked
          ? Promise.reject(new DOMException("Blocked", "NotFoundError"))
          : getFile.call(this);
      };
    }
    const fetch = window.fetch;
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return state.blocked && url.startsWith("blob:")
        ? Promise.resolve(new Response(null, { status: 404 }))
        : fetch(input, init);
    };
  });
}

function setMediaServeBlocked(page: Page, blocked: boolean) {
  return page.evaluate((value) => {
    (
      window as unknown as { __mediaServe: { blocked: boolean } }
    ).__mediaServe.blocked = value;
  }, blocked);
}

function offlineLabel(page: Page) {
  return page.locator(".track-label__offline");
}

function mediaLabels(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __mediaLabels: string[] }).__mediaLabels,
  );
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

// `place` also puts the source clip on the timeline; without it the video is
// only on a source track.
async function dropVideo(page: Page, { place = true } = {}) {
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
  if (!place) {
    return;
  }
  // Ctrl/Cmd+click places the source clip on the timeline.
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".clip-card")).toHaveCount(1);
}

// A one-second 16-bit mono sine tone as a WAV file.
function toneWav(frequency: number) {
  const sampleRate = 8000;
  const samples = sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate);
    buffer.writeInt16LE(Math.round(value * 16000), 44 + index * 2);
  }
  return buffer;
}

function audioRow(page: Page) {
  return page.locator("[data-audio-row]");
}

// Drops a tone on a new source track, which gives its clip a Gain.
async function addToneTrack(page: Page, name: string, frequency: number) {
  const spans = await page.locator(".source-span").count();
  const base64 = toneWav(frequency).toString("base64");
  const dataTransfer = await page.evaluateHandle(
    ({ data, name }) => {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: "audio/wav" }));
      return transfer;
    },
    { data: base64, name },
  );
  // With a track already there, a new one comes from the new-track row that
  // dragging over a track shows.
  if (spans) {
    for (const type of ["dragenter", "dragover"]) {
      await page.dispatchEvent(
        '[data-source-track-drop-target="track"]',
        type,
        {
          dataTransfer,
        },
      );
    }
  }
  const target = spans
    ? ".track-row--source-drop"
    : '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(spans + 1, {
    timeout: 30_000,
  });
}

// The Audio row draws the resolved mix once its media has arrived.
async function expectAudioWaveform(page: Page) {
  await expect(audioRow(page)).toContainText(
    /From source tracks · \d+ clips?/,
    {
      timeout: 30_000,
    },
  );
  await expect(
    audioRow(page).locator('[data-audio-mix="ready"] .waveform__canvas'),
  ).toBeVisible({ timeout: 30_000 });
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
  // Media on its way from the host shows as syncing, never as offline.
  const labels = await mediaLabels(guest);
  expect(labels.filter((label) => /offline/i.test(label))).toEqual([]);

  // The media sync modal lists the received media as ready.
  await guest.getByRole("menuitem", { name: "File", exact: true }).click();
  await guest.getByRole("menuitem", { name: "Media Sync Status…" }).click();
  const mediaSync = guest.getByRole("dialog", { name: "Media Sync" });
  await expect(mediaSync).toContainText("All session media is ready.");
  await mediaSync.getByRole("button", { name: "1 ready" }).click();
  await expect(mediaSync).toContainText("test-pattern.mp4");
  await expect(mediaSync).toContainText("Ready");
  await mediaSync.getByRole("button", { name: "Close" }).click();
  await expect(mediaSync).toHaveCount(0);

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

test("audio and source-track-only media added during a share reach the guest", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const host = await openApp(browser);
  const invitePath = await startSharing(host);
  const guest = await openApp(browser, invitePath);
  await expect(connectionStatus(guest)).toHaveText("1 peer connected", {
    timeout: 30_000,
  });
  await expect(audioRow(guest)).toContainText("No audio");

  // Video that is only on a source track, never placed on a layer.
  await dropVideo(host, { place: false });
  await expect(guest.locator(".source-span")).toHaveCount(1);
  await expect(guest.locator(".clip-card")).toHaveCount(0);
  await expect(guest.locator(".source-span")).not.toContainText(
    "offline clip",
    { timeout: 30_000 },
  );

  // Audio imported into a source track mid-share reaches the guest without
  // a reload, and its Audio row draws the mix.
  await addToneTrack(host, "tone.wav", 440);
  await expectAudioWaveform(host);
  await expectAudioWaveform(guest);
  await expect(guest.locator(".track-label__offline")).toHaveCount(0);
});

// A host with a video it can't read, sharing, and a guest that has joined
// and failed to get the video from it.
async function joinHostThatCantServe(browser: Browser) {
  const host = await openApp(browser, "/", { blockableServe: true });
  await dropVideo(host);
  await setMediaServeBlocked(host, true);
  const invitePath = await startSharing(host);
  const guest = await openApp(browser, invitePath);
  await expect(connectionStatus(guest)).toHaveText("1 peer connected", {
    timeout: 30_000,
  });
  await expect(guest.locator(".clip-card")).toHaveCount(1);
  // Media no peer could send is offline, not syncing. If the block misses a
  // place the host reads media from, the guest receives the file and the
  // label goes away; the call log then only shows the "Syncing" label seen
  // before that, which looks like a stuck sync but isn't one.
  await expect(
    offlineLabel(guest),
    "the host shouldn't be able to send the video",
  ).toHaveText("1 offline media file", { timeout: 30_000 });
  return { host, guest };
}

test("Retry in the media sync modal requests unavailable media again", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { host, guest } = await joinHostThatCantServe(browser);

  // In a share, the offline label opens the media sync modal.
  await offlineLabel(guest).click();
  const mediaSync = guest.getByRole("dialog", { name: "Media Sync" });
  await expect(mediaSync).toBeVisible();
  await expect(
    guest.getByRole("dialog", { name: "Offline Media" }),
  ).toHaveCount(0);
  await expect(mediaSync).toContainText("1 file no connected peer could send.");
  const row = mediaSync.locator(".media-sync-dialog__row", {
    hasText: "test-pattern.mp4",
  });
  await expect(row.locator(".media-sync-dialog__chip")).toHaveText(
    "Unavailable",
  );

  // Once the host can send the file, Retry fetches it.
  await setMediaServeBlocked(host, false);
  await row.getByRole("button", { name: "Retry" }).click();
  await expect(mediaSync).toContainText("All session media is ready.", {
    timeout: 30_000,
  });
  await mediaSync.getByRole("button", { name: "1 ready" }).click();
  await expect(row.locator(".media-sync-dialog__chip")).toHaveText("Ready");
  await expect(offlineLabel(guest)).toHaveCount(0);
});

test("New Session is off while sharing", async ({
  browser,
}) => {
  const host = await openApp(browser);
  await renameLayer(host, "5", "Host layer");
  await startSharing(host);

  // Starting over would wipe the peers' project too.
  await host.getByRole("menuitem", { name: "File", exact: true }).click();
  await expect(
    host.getByRole("menuitem", { name: "New Session", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
});

test("outside a share, the offline label opens the offline media dialog", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { guest } = await joinHostThatCantServe(browser);

  await guest.getByRole("menuitem", { name: "File", exact: true }).click();
  await guest
    .getByRole("menuitem", { name: "Disconnect from Share", exact: true })
    .click();
  await expect(offlineLabel(guest)).toHaveText("1 offline media file");
  await offlineLabel(guest).click();
  await expect(
    guest.getByRole("dialog", { name: "Offline Media" }),
  ).toBeVisible();
  await expect(guest.getByRole("dialog", { name: "Media Sync" })).toHaveCount(
    0,
  );
});

test("a guest with no host waits, then says the host wasn't found", async ({
  browser,
}) => {
  const guest = await openApp(
    browser,
    `/?room=nobody-home&signal=${encodeURIComponent(signaling.url)}`,
    { clock: true },
  );
  await expect(connectionStatus(guest)).toHaveText("Waiting for host...", {
    timeout: 15_000,
  });
  // Past the app's 20 s wait for a host (HOST_TIMEOUT_MS).
  await guest.clock.fastForward(21_000);
  await expect(connectionStatus(guest)).toHaveText(
    "Host not found, check the invite and that the host is sharing",
  );
  // The guest never publishes its own project into the room.
  await expect(layerNames(guest)).toHaveText(["Layer 1", "Layer 2", "Layer 3"]);
});

test("an unreachable signaling server is reported", async ({ browser }) => {
  const guest = await openApp(
    browser,
    `/?room=nowhere&signal=${encodeURIComponent("ws://127.0.0.1:9")}`,
    { clock: true },
  );
  // Past the app's 10 s signaling timeout (SIGNALING_TIMEOUT_MS).
  await guest.clock.fastForward(11_000);
  await expect(connectionStatus(guest)).toHaveText(
    "Can't reach the signaling server",
  );
  await connectionStatus(guest).click();
  await expect(
    guest.getByRole("dialog", { name: "Connection diagnostics" }),
  ).toContainText("Signaling ws://127.0.0.1:9Unreachable");
});
