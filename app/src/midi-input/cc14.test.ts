import assert from "node:assert/strict";
import { test } from "node:test";
import { cc14Reader } from "./cc14.ts";

const cc = (controller: number, value: number, channel = 1) => ({
  type: "cc" as const,
  channel,
  controller,
  value,
});

function reader() {
  const clock = { now: 0 };
  return { read: cc14Reader(() => clock.now), clock };
}

test("an LSB straight after its MSB reads as the MSB's control at 14 bits", () => {
  const { read } = reader();
  assert.deepEqual(read(cc(1, 64)), cc(1, 64));
  assert.deepEqual(read(cc(33, 100)), {
    ...cc(33, 100),
    controller: 1,
    to: ((64 << 7) | 100) / 16383,
  });
});

test("a 14-bit control covers its whole range", () => {
  const { read } = reader();
  read(cc(1, 127));
  assert.equal(read(cc(33, 127)).to, 1);
  assert.equal(read(cc(1, 0)).to, 0);
  assert.equal(read(cc(33, 0)).to, 0);
});

test("controllers 32 to 63 stay separate controls when they arrive alone", () => {
  const { read, clock } = reader();
  assert.deepEqual(read(cc(33, 10)), cc(33, 10));
  assert.deepEqual(read(cc(1, 20)), cc(1, 20));
  clock.now += 50;
  assert.deepEqual(read(cc(33, 30)), cc(33, 30));
  assert.deepEqual(read(cc(64, 40)), cc(64, 40));
});

test("only a controller's own LSB, on its channel, pairs with it", () => {
  const { read } = reader();
  read(cc(1, 64));
  assert.deepEqual(read(cc(34, 5)), cc(34, 5));
  read(cc(1, 64));
  assert.deepEqual(read(cc(33, 5, 2)), cc(33, 5, 2));
  assert.equal(read(cc(33, 5)).controller, 1);
});

test("an LSB alone moves a control seen pairing repeatedly, with its last MSB", () => {
  const { read, clock } = reader();
  read(cc(1, 64));
  read(cc(33, 1));
  clock.now += 50;
  assert.deepEqual(read(cc(33, 2)), cc(33, 2));
  read(cc(1, 64));
  read(cc(33, 3));
  clock.now += 50;
  assert.deepEqual(read(cc(33, 4)), {
    ...cc(33, 4),
    controller: 1,
    to: ((64 << 7) | 4) / 16383,
  });
});

test("two 7-bit controls moved together don't stay paired", () => {
  const { read, clock } = reader();
  read(cc(1, 10));
  assert.equal(read(cc(33, 20)).controller, 1);
  clock.now += 50;
  read(cc(1, 11));
  clock.now += 50;
  assert.deepEqual(read(cc(1, 12)), cc(1, 12));
  clock.now += 50;
  assert.deepEqual(read(cc(33, 21)), cc(33, 21));
});
