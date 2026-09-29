import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPublicShareUrl,
  isLocalHostname,
  parseInviteParams,
  removeInvitePassword,
} from "./share-link.ts";

const SIGNALING = ["wss://signal.example.com"];

describe("buildPublicShareUrl", () => {
  it("keeps the deployed origin and path", () => {
    const { url, localOnly } = buildPublicShareUrl("abc123", SIGNALING, "", {
      origin: "https://zvid.example.com",
      pathname: "/app/",
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://zvid.example.com");
    assert.equal(parsed.pathname, "/app/");
    assert.equal(parsed.searchParams.get("room"), "abc123");
    assert.equal(parsed.searchParams.get("signal"), "wss://signal.example.com");
    assert.equal(parsed.hash, "");
    assert.equal(localOnly, false);
  });

  it("uses the configured public app URL over the page origin", () => {
    const { url, localOnly } = buildPublicShareUrl("abc123", SIGNALING, "", {
      origin: "http://localhost:1420",
      pathname: "/",
      publicAppUrl: "https://public.example.com/zvid/",
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://public.example.com");
    assert.equal(parsed.pathname, "/zvid/");
    assert.equal(localOnly, false);
  });

  it("ignores a blank or invalid public app URL", () => {
    for (const publicAppUrl of ["", "   ", "not a url"]) {
      const { url } = buildPublicShareUrl("abc123", SIGNALING, "", {
        origin: "https://zvid.example.com",
        pathname: "/",
        publicAppUrl,
      });
      assert.equal(new URL(url).origin, "https://zvid.example.com");
    }
  });

  it("flags a localhost or private origin as local-only", () => {
    for (const origin of [
      "http://localhost:1420",
      "http://127.0.0.1:1420",
      "http://192.168.1.20:1420",
      "http://10.0.0.5:1420",
      "http://[::1]:1420",
    ]) {
      const { url, localOnly } = buildPublicShareUrl("abc123", SIGNALING, "", {
        origin,
        pathname: "/",
      });
      assert.equal(new URL(url).origin, origin);
      assert.equal(localOnly, true, origin);
    }
  });

  it("puts the password in the fragment, never the query", () => {
    const { url } = buildPublicShareUrl("abc123", SIGNALING, " s3cr&t ", {
      origin: "https://zvid.example.com",
      pathname: "/",
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.has("password"), false);
    assert.equal(
      new URLSearchParams(parsed.hash.slice(1)).get("password"),
      "s3cr&t",
    );
  });
});

describe("parseInviteParams", () => {
  it("round-trips a built share URL", () => {
    const { url } = buildPublicShareUrl("abc123", SIGNALING, "s3cr&t", {
      origin: "https://zvid.example.com",
      pathname: "/",
    });
    assert.deepEqual(parseInviteParams(url), {
      room: "abc123",
      signal: "wss://signal.example.com",
      password: "s3cr&t",
    });
  });

  it("still reads the password from the query of old links", () => {
    const invite = parseInviteParams(
      "http://203.0.113.7:1420/?room=abc123&signal=wss%3A%2F%2Fs&password=old",
    );
    assert.equal(invite.room, "abc123");
    assert.equal(invite.password, "old");
  });

  it("prefers the fragment password over the query", () => {
    const invite = parseInviteParams(
      "https://zvid.example.com/?room=r&password=query#password=hash",
    );
    assert.equal(invite.password, "hash");
  });

  it("reads a bare query string with a fragment", () => {
    assert.deepEqual(parseInviteParams("?room=r&signal=wss://s#password=p"), {
      room: "r",
      signal: "wss://s",
      password: "p",
    });
    assert.equal(parseInviteParams("room=r").room, "r");
  });
});

describe("removeInvitePassword", () => {
  it("clears the password from the fragment", () => {
    assert.equal(
      removeInvitePassword("https://zvid.example.com/?room=r#password=p"),
      "https://zvid.example.com/?room=r",
    );
  });

  it("clears the password from the query of old links", () => {
    assert.equal(
      removeInvitePassword("https://zvid.example.com/?room=r&password=p"),
      "https://zvid.example.com/?room=r",
    );
  });

  it("keeps other fragment entries", () => {
    assert.equal(
      removeInvitePassword("https://zvid.example.com/?room=r#password=p&x=1"),
      "https://zvid.example.com/?room=r#x=1",
    );
  });

  it("returns null when there is no password to clear", () => {
    assert.equal(
      removeInvitePassword("https://zvid.example.com/?room=r#section"),
      null,
    );
  });
});

describe("isLocalHostname", () => {
  it("treats public hosts as shareable", () => {
    assert.equal(isLocalHostname("zvid.example.com"), false);
    assert.equal(isLocalHostname("172.32.0.1"), false);
    assert.equal(isLocalHostname("203.0.113.7"), false);
  });
});
