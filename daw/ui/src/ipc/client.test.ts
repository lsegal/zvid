import assert from "node:assert/strict";
import test from "node:test";
import { WebDriver } from "../web/driver.ts";
import { MockBackend } from "../web/mock-backend.ts";
import { Client, CommandError } from "./client.ts";
import type { UiEvent } from "./types.ts";

type Call = { url: string; init?: RequestInit };

/** A client on the web driver that records every request. */
function connect(options: { clip?: string } = {}) {
  const driver = new WebDriver({
    backend: new MockBackend({ clip: options.clip }),
  });
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return driver.fetch(url, init);
  }) as typeof fetch;
  return { driver, calls, client: new Client(driver.config, fetchImpl) };
}

async function until(check: () => boolean): Promise<void> {
  while (!check()) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("invokes commands with JSON arguments", async () => {
  const { calls, client } = connect();
  assert.equal(await client.invoke("selectCamera", { id: "mock-usb" }), null);
  assert.equal(calls[0].url, "zvid://ipc/selectCamera");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, '{"id":"mock-usb"}');
  assert.equal((await client.invoke("getStatus")).cameraId, "mock-usb");
  assert.deepEqual(await client.invoke("listTakes"), []);
  assert.equal(calls[2].init?.body, "null");
});

test("rejects failed commands with the backend's error", async () => {
  const { client } = connect();
  await assert.rejects(
    client.invoke("selectCamera", { id: "mock-denied" }),
    (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.code, "permissionDenied");
      assert.equal(
        error.message,
        "Camera access is turned off for Ableton Live.",
      );
      return true;
    },
  );
  await assert.rejects(
    client.invoke("arm"),
    (error: unknown) =>
      error instanceof CommandError && error.code === "invalidRequest",
  );
  // A failure without the backend's error body.
  const bare = new Client(
    connect().driver.config,
    (async () => new Response("", { status: 500 })) as typeof fetch,
  );
  await assert.rejects(bare.invoke("disarm"), /disarm failed \(500\)/);
});

test("joins the event stream, then follows the cursor", async () => {
  const { driver, calls, client } = connect();
  const controller = new AbortController();
  const events: UiEvent[] = [];
  let resyncs = 0;
  // Events from before the page joined are covered by its first reload.
  driver.backend.refreshDevices();
  const done = client.listen(
    (event) => events.push(event),
    () => {
      resyncs++;
    },
    controller.signal,
  );
  await until(() => calls.length === 2);
  driver.backend.selectCamera("mock-builtin");
  driver.backend.arm();
  await until(() => events.length === 2);
  controller.abort();
  await done;
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "zvid://ipc/events",
      "zvid://ipc/events?after=1",
      // Both events arrived in one batch.
      "zvid://ipc/events?after=3",
    ],
  );
  assert.deepEqual(
    events.map((event) =>
      event.event === "status" ? event.payload.phase : event.event,
    ),
    ["ready", "capturing"],
  );
  assert.equal(resyncs, 1);
});

test("resyncs after missing events", async () => {
  const { driver, calls, client } = connect();
  const controller = new AbortController();
  let resyncs = 0;
  const done = client.listen(
    () => undefined,
    () => {
      resyncs++;
    },
    controller.signal,
  );
  await until(() => calls.length === 2);
  controller.abort();
  await done;
  // A poller that fell behind the backlog, as after a long sleep.
  for (let index = 0; index < 300; index++) driver.backend.refreshDevices();
  const again = new AbortController();
  const events: UiEvent[] = [];
  const next = client.listen(
    (event) => events.push(event),
    () => {
      resyncs++;
    },
    again.signal,
  );
  await until(() => resyncs === 2);
  again.abort();
  await next;
  assert.deepEqual(events, []);
});

test("streams preview frames as object URLs", async () => {
  const { driver, calls, client } = connect();
  const controller = new AbortController();
  const frames: Array<string | null> = [];
  const done = client.streamPreview(
    (url) => frames.push(url),
    controller.signal,
  );
  await until(() => calls.length === 1);
  driver.backend.selectCamera("mock-builtin");
  driver.backend.publishFrame();
  await until(() => calls.length === 2);
  controller.abort();
  await done;
  assert.deepEqual(
    calls.map((call) => call.url),
    ["zvid://preview/frame?after=0", "zvid://preview/frame?after=1"],
  );
  assert.equal(frames.length, 1);
  assert.match(frames[0] ?? "", /^blob:/);
  URL.revokeObjectURL(frames[0] ?? "");
});

test("reports desktop actions to the driver", async () => {
  const { driver, client } = connect({ clip: "clip.mp4" });
  await client.invoke("selectCamera", { id: "mock-builtin" });
  await client.invoke("arm");
  await client.invoke("disarm");
  const [take] = await client.invoke("listTakes");
  assert.equal(take.missing, false);
  assert.equal(await client.invoke("revealTake", { id: take.id }), null);
  await client.invoke("openPrivacySettings");
  await assert.rejects(
    client.invoke("revealTake", { id: "nope" }),
    /unknown take/,
  );
  assert.deepEqual(driver.desktop, [
    { action: "revealTake", id: take.id },
    { action: "openPrivacySettings" },
  ]);
});

test("builds media URLs", () => {
  const { client } = connect();
  assert.equal(client.takeUrl("a b"), "zvid://take/a%20b");
  assert.equal(client.thumbUrl("x"), "zvid://thumb/x");
});
