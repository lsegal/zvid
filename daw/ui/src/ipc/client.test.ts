import assert from "node:assert/strict";
import test from "node:test";
import { Client, CommandError } from "./client.ts";
import type { UiEvent, ZvidConfig } from "./types.ts";

const config: ZvidConfig = {
  origins: {
    app: "zvid://app",
    ipc: "zvid://ipc",
    preview: "zvid://preview",
    take: "zvid://take",
    thumb: "zvid://thumb",
    frames: "zvid://frames",
  },
  version: "0.1.0",
  platform: "macos",
};

type Call = { url: string; init?: RequestInit };

/** A fetch that answers from a queue and records every call. */
function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) {
      // Park like a long-poll until the caller aborts.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
    }
    return next();
  }) as typeof fetch;
  return { calls, impl };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status });

test("invokes commands with JSON arguments", async () => {
  const { calls, impl } = fakeFetch([json(null), json([{ id: "a" }])]);
  const client = new Client(config, impl);
  assert.equal(await client.invoke("selectCamera", { id: "cam 1" }), null);
  assert.equal(calls[0].url, "zvid://ipc/selectCamera");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, '{"id":"cam 1"}');
  assert.deepEqual(await client.invoke("listTakes"), [{ id: "a" }]);
  assert.equal(calls[1].init?.body, "null");
});

test("rejects failed commands with the backend's error", async () => {
  const { impl } = fakeFetch([
    json({ code: "permissionDenied", message: "Camera access is off" }, 409),
    () => new Response("", { status: 500 }),
  ]);
  const client = new Client(config, impl);
  await assert.rejects(client.invoke("arm"), (error: unknown) => {
    assert.ok(error instanceof CommandError);
    assert.equal(error.code, "permissionDenied");
    assert.equal(error.message, "Camera access is off");
    return true;
  });
  await assert.rejects(client.invoke("disarm"), /disarm failed \(500\)/);
});

test("joins the event stream, then follows the cursor", async () => {
  const status: UiEvent = {
    event: "takeOpened",
    payload: { index: 0 },
  };
  const { calls, impl } = fakeFetch([
    json({ cursor: 4, resync: false, events: [] }),
    json({ cursor: 5, resync: false, events: [status] }),
    json({ cursor: 90, resync: true, events: [] }),
  ]);
  const client = new Client(config, impl);
  const controller = new AbortController();
  const events: UiEvent[] = [];
  let resyncs = 0;
  const done = client.listen(
    (event) => events.push(event),
    () => {
      resyncs++;
    },
    controller.signal,
  );
  while (calls.length < 4) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  controller.abort();
  await done;
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "zvid://ipc/events",
      "zvid://ipc/events?after=4",
      "zvid://ipc/events?after=5",
      "zvid://ipc/events?after=90",
    ],
  );
  assert.deepEqual(events, [status]);
  assert.equal(resyncs, 2);
});

test("streams preview frames as object URLs", async () => {
  const frame = () =>
    new Response(new Uint8Array([0xff, 0xd8]), {
      headers: { "X-Frame-Seq": "7", "Content-Type": "image/jpeg" },
    });
  const { calls, impl } = fakeFetch([
    () => new Response(null, { status: 204 }),
    frame,
  ]);
  const client = new Client(config, impl);
  const controller = new AbortController();
  const frames: Array<string | null> = [];
  const done = client.streamPreview(
    (url) => frames.push(url),
    controller.signal,
  );
  while (calls.length < 3) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  controller.abort();
  await done;
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "zvid://preview/frame?after=0",
      "zvid://preview/frame?after=0",
      "zvid://preview/frame?after=7",
    ],
  );
  assert.equal(frames.length, 1);
  assert.match(frames[0] ?? "", /^blob:/);
  URL.revokeObjectURL(frames[0] ?? "");
});

test("builds media URLs", () => {
  const client = new Client(config, fakeFetch([]).impl);
  assert.equal(client.takeUrl("a b"), "zvid://take/a%20b");
  assert.equal(client.thumbUrl("x"), "zvid://thumb/x");
  assert.equal(client.frameUrl("a b", 1.5), "zvid://frames/a%20b?t=1.500");
});

test("fetches host-decoded take frames", async () => {
  const { calls, impl } = fakeFetch([
    () => new Response(new Uint8Array([0xff, 0xd8]), { status: 200 }),
    json({ code: "notFound", message: "the take's file is missing" }, 404),
    () => new Response("unknown take", { status: 404 }),
  ]);
  const client = new Client(config, impl);
  const signal = new AbortController().signal;
  const url = await client.takeFrame("t1", 2, signal);
  assert.match(url, /^blob:/);
  URL.revokeObjectURL(url);
  assert.equal(calls[0].url, "zvid://frames/t1?t=2.000");
  assert.equal(calls[0].init?.signal, signal);
  await assert.rejects(client.takeFrame("t1", 3, signal), {
    name: "CommandError",
    code: "notFound",
    message: "the take's file is missing",
  });
  await assert.rejects(client.takeFrame("t2", 0, signal), {
    code: "internal",
    message: "frame failed (404)",
  });
});
