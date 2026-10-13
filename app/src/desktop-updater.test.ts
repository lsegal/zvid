import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkForDesktopUpdate,
  type DesktopUpdate,
  type DesktopUpdaterDeps,
} from "./desktop-updater.ts";

function fakeUpdater({
  update = null as DesktopUpdate | null,
  checkError = null as Error | null,
  accept = true,
} = {}) {
  const calls: string[] = [];
  const deps: DesktopUpdaterDeps = {
    check: async () => {
      calls.push("check");
      if (checkError) throw checkError;
      return update;
    },
    ask: async (message) => {
      calls.push(`ask: ${message}`);
      return accept;
    },
    relaunch: async () => {
      calls.push("relaunch");
    },
  };
  return { calls, deps };
}

function fakeUpdate(installError: Error | null = null) {
  const update = {
    version: "0.0.42",
    installs: 0,
    async downloadAndInstall() {
      update.installs += 1;
      if (installError) throw installError;
    },
  };
  return update;
}

describe("checkForDesktopUpdate", () => {
  it("does nothing outside the desktop app", async () => {
    assert.equal(await checkForDesktopUpdate({ interactive: true }), null);
  });

  it("installs an accepted update, then relaunches", async () => {
    const update = fakeUpdate();
    const { calls, deps } = fakeUpdater({ update });
    const statuses: string[] = [];

    const result = await checkForDesktopUpdate({
      interactive: false,
      onStatus: (message) => statuses.push(message),
      deps,
    });

    assert.equal(result, "installed");
    assert.equal(update.installs, 1);
    assert.deepEqual(calls, [
      "check",
      "ask: zvid 0.0.42 is available. Install it and relaunch zvid now?",
      "relaunch",
    ]);
    assert.deepEqual(statuses, ["Installing zvid 0.0.42…"]);
  });

  it("leaves a declined update uninstalled", async () => {
    const update = fakeUpdate();
    const { calls, deps } = fakeUpdater({ update, accept: false });

    assert.equal(
      await checkForDesktopUpdate({ interactive: true, deps }),
      "declined",
    );
    assert.equal(update.installs, 0);
    assert.ok(!calls.includes("relaunch"));
  });

  it("doesn't relaunch when installing fails, such as a bad signature", async () => {
    const update = fakeUpdate(new Error("signature verification failed"));
    const { calls, deps } = fakeUpdater({ update });
    const statuses: string[] = [];

    const result = await checkForDesktopUpdate({
      interactive: false,
      onStatus: (message) => statuses.push(message),
      deps,
    });

    assert.equal(result, "failed");
    assert.ok(!calls.includes("relaunch"));
    assert.deepEqual(statuses, [
      "Installing zvid 0.0.42…",
      "Couldn't install zvid 0.0.42.",
    ]);
  });

  it("reports no update and check failures only when asked from the menu", async () => {
    for (const [options, result, status] of [
      [{}, "up-to-date", "zvid is up to date."],
      [
        { checkError: new Error("offline") },
        "failed",
        "Couldn't check for updates. Try again later.",
      ],
    ] as const) {
      for (const interactive of [false, true]) {
        const { deps } = fakeUpdater(options);
        const statuses: string[] = [];
        assert.equal(
          await checkForDesktopUpdate({
            interactive,
            onStatus: (message) => statuses.push(message),
            deps,
          }),
          result,
        );
        assert.deepEqual(statuses, interactive ? [status] : []);
      }
    }
  });
});
