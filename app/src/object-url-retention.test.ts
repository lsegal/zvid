import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { retainObjectUrls, revokeObjectUrl } from "./object-url-retention.ts";

describe("object URL retention", () => {
  const original = URL.revokeObjectURL;
  let revoked: string[];

  beforeEach(() => {
    revoked = [];
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
  });

  afterEach(() => {
    URL.revokeObjectURL = original;
  });

  it("revokes an unretained URL right away", () => {
    revokeObjectUrl("blob:free");
    assert.deepEqual(revoked, ["blob:free"]);
  });

  it("defers revoking a retained URL until it is released", () => {
    const release = retainObjectUrls(["blob:a", "blob:b"]);
    revokeObjectUrl("blob:a");
    assert.deepEqual(revoked, []);

    release();
    // Only the URL whose revoke was deferred is revoked.
    assert.deepEqual(revoked, ["blob:a"]);
    revokeObjectUrl("blob:b");
    assert.deepEqual(revoked, ["blob:a", "blob:b"]);
  });

  it("waits for every holder", () => {
    const first = retainObjectUrls(["blob:shared"]);
    const second = retainObjectUrls(["blob:shared"]);
    revokeObjectUrl("blob:shared");
    first();
    first();
    assert.deepEqual(revoked, []);
    second();
    assert.deepEqual(revoked, ["blob:shared"]);
  });

  it("ignores URLs that are not blob URLs", () => {
    const release = retainObjectUrls(["asset://file.mp4", undefined]);
    revokeObjectUrl("asset://file.mp4");
    assert.deepEqual(revoked, ["asset://file.mp4"]);
    release();
    assert.deepEqual(revoked, ["asset://file.mp4"]);
  });
});
