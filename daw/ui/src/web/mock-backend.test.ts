import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSY_CAMERA,
  DENIED_CAMERA,
  EVENT_BACKLOG,
  EventLog,
  MockBackend,
  PreviewSlot,
  rfc3339Utc,
} from "./mock-backend.ts";

/** A backend on a clock the test moves by hand. */
function backend(options: { clip?: string } = {}) {
  const clock = { ms: Date.parse("2026-09-25T20:36:12Z") };
  const mock = new MockBackend({ ...options, now: () => clock.ms });
  return { mock, clock };
}

async function eventNames(mock: MockBackend): Promise<string[]> {
  const batch = await mock.events.poll(0, 1);
  return batch.events.map((event) => event.event);
}

test("formats RFC 3339 timestamps to the second", () => {
  assert.equal(rfc3339Utc(0), "1970-01-01T00:00:00Z");
  assert.equal(rfc3339Utc(1_790_368_572_999), "2026-09-25T20:36:12Z");
});

test("walks through the capture states", async () => {
  const { mock, clock } = backend();
  assert.equal(mock.status().phase, "noCamera");
  assert.throws(() => mock.arm(), /choose a working camera/);

  mock.selectCamera("mock-builtin");
  assert.equal(mock.status().phase, "ready");
  mock.publishFrame();
  assert.ok(mock.preview.latest());

  mock.arm();
  assert.equal(mock.status().phase, "capturing");
  assert.throws(() => mock.selectCamera("mock-usb"), /stop capturing/);
  mock.setPlaying(true);
  clock.ms += 2000;
  mock.setPlaying(false);
  mock.setPlaying(true);
  clock.ms += 11_000;
  assert.deepEqual(mock.status().capture, {
    elapsedMs: 13_000,
    takes: 2,
    droppedFrames: 1,
  });
  mock.disarm();

  const takes = mock.takes();
  assert.equal(takes.length, 2);
  assert.ok(takes.every((take) => !take.unanchored && take.missing));
  assert.deepEqual(takes[0].timeSignature, [4, 4]);
  assert.equal(takes[0].durationSec, 11);
  // The song moved on past the first take.
  assert.equal(takes[0].transportStartBeats, 64 + 4 + 4);
  assert.equal(mock.status().phase, "ready");

  const names = await eventNames(mock);
  assert.equal(names.filter((name) => name === "takeOpened").length, 2);
  assert.equal(names.filter((name) => name === "takeClosed").length, 2);
});

test("reports the Live companion", async () => {
  const { mock } = backend();
  assert.equal(mock.status().live, null);
  mock.setLive({ recordArmed: true });
  mock.setLive({ recordArmed: true });
  assert.deepEqual(mock.status().live, { recordArmed: true });
  mock.setLive(null);
  assert.equal(mock.status().live, null);
  const batch = await mock.events.poll(0, 1);
  assert.deepEqual(
    batch.events.map((event) =>
      event.event === "status" ? event.payload.live : undefined,
    ),
    [{ recordArmed: true }, null],
  );
});

test("a capture without playback is unanchored", () => {
  const { mock } = backend({ clip: "clip.mp4" });
  mock.selectCamera("mock-builtin");
  mock.arm();
  mock.disarm();
  const takes = mock.takes();
  assert.equal(takes.length, 1);
  assert.ok(takes[0].unanchored);
  assert.equal(takes[0].missing, false);
  assert.equal(takes[0].filename, "clip.mp4");
  assert.ok(mock.take(takes[0].id));
  assert.equal(mock.take("nope"), undefined);
});

test("failing cameras report errors", () => {
  const { mock } = backend();
  assert.throws(
    () => mock.selectCamera(DENIED_CAMERA),
    (error: { error?: { code: string } }) =>
      error.error?.code === "permissionDenied",
  );
  const status = mock.status();
  assert.equal(status.phase, "error");
  assert.equal(status.error?.code, "permissionDenied");
  assert.throws(() => mock.arm());
  mock.publishFrame();
  assert.equal(mock.preview.latest(), null);

  assert.throws(
    () => mock.selectCamera(BUSY_CAMERA),
    (error: { error?: { code: string } }) => error.error?.code === "deviceBusy",
  );
  mock.selectCamera("mock-iphone");
  assert.equal(mock.status().phase, "ready");
  assert.equal(mock.status().format?.height, 1920);
  assert.throws(() => mock.selectCamera("gone"), /that camera is gone/);
});

test("refresh finds the phone", async () => {
  const { mock } = backend();
  const before = mock.cameras().length;
  assert.equal(mock.refreshDevices().length, before + 1);
  assert.equal(mock.refreshDevices().length, before + 1);
  assert.equal((await eventNames(mock))[0], "camerasChanged");
});

test("lists takes newest first", () => {
  const take = (id: string, createdAt: string) => ({
    id,
    filename: `${id}.mp4`,
    createdAt,
    durationSec: 1,
    fileOffsetSec: 0,
    transportStartBeats: null,
    timeSignature: null,
    unanchored: true,
    missing: false,
  });
  const mock = new MockBackend({
    takes: [
      take("a", "2026-09-25T10:00:00Z"),
      take("b", "2026-09-25T12:00:00Z"),
      take("c", "2026-09-25T10:00:00Z"),
    ],
  });
  assert.deepEqual(
    mock.takes().map((take) => take.id),
    ["b", "c", "a"],
  );
});

test("event polls wait for the next event", async () => {
  const log = new EventLog();
  assert.deepEqual(await log.poll(undefined, 1000), {
    cursor: 0,
    resync: false,
    events: [],
  });
  const waiting = log.poll(0, 1000);
  log.emit({ event: "takeOpened", payload: { index: 0 } });
  assert.deepEqual(await waiting, {
    cursor: 1,
    resync: false,
    events: [{ event: "takeOpened", payload: { index: 0 } }],
  });
  // Nothing new: the poll times out empty.
  assert.deepEqual((await log.poll(1, 5)).events, []);
});

test("event polls end when aborted", async () => {
  const log = new EventLog();
  const controller = new AbortController();
  const waiting = log.poll(0, 60_000, controller.signal);
  controller.abort(new Error("closed"));
  await assert.rejects(waiting, /closed/);
});

test("asks laggards to resync", async () => {
  const log = new EventLog();
  for (let index = 0; index < EVENT_BACKLOG + 10; index++) {
    log.emit({ event: "takeOpened", payload: { index } });
  }
  const behind = await log.poll(1, 1);
  assert.ok(behind.resync);
  assert.deepEqual(behind.events, []);
  assert.equal(behind.cursor, EVENT_BACKLOG + 10);
  assert.equal((await log.poll(20, 1)).resync, false);
  // So is a cursor from a restarted backend.
  assert.ok((await log.poll(10_000, 1)).resync);
});

test("preview polls serve only the newest frame", async () => {
  const slot = new PreviewSlot();
  assert.equal(await slot.poll(0, 5), null);
  const waiting = slot.poll(0, 1000);
  slot.publish(new Blob(["a"]));
  slot.publish(new Blob(["b"]));
  const frame = await waiting;
  assert.equal(frame?.seq, 2);
  assert.equal(await frame?.frame.text(), "b");
  slot.clear();
  assert.equal(await slot.poll(2, 5), null);
});
