import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SharedAudioContext } from "./shared-audio-context.ts";

class FakeContext {
  state = "suspended";
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
}

describe("shared audio context", () => {
  it("hands every user the same context", () => {
    let created = 0;
    const shared = new SharedAudioContext(() => {
      created += 1;
      return new FakeContext();
    });
    const first = shared.acquire();
    const second = shared.acquire();
    assert.equal(first, second);
    assert.equal(created, 1);
    assert.equal(shared.userCount, 2);
  });

  it("suspends once nothing uses it and resumes for the next user", () => {
    const shared = new SharedAudioContext(() => new FakeContext());
    const context = shared.acquire();
    shared.acquire();
    assert.equal(context.state, "running");
    shared.release();
    assert.equal(context.state, "running");
    shared.release();
    assert.equal(context.state, "suspended");
    assert.equal(shared.acquire(), context);
    assert.equal(context.state, "running");
  });

  it("replaces a closed context", () => {
    const shared = new SharedAudioContext(() => new FakeContext());
    const context = shared.acquire();
    context.state = "closed";
    assert.notEqual(shared.acquire(), context);
  });
});
