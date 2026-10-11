import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry } from "../context-menu.ts";
import {
  type PhoneShareState,
  phoneShareButtonLabel,
  phoneShareSheetEntries,
} from "./share-control.ts";

const IDLE: PhoneShareState = {
  mode: "idle",
  isStartingShare: false,
  hasCopiedShareInvite: false,
  shareUrl: "",
  stateLabel: "Not connected",
};
const SHARING: PhoneShareState = {
  ...IDLE,
  mode: "sharing",
  shareUrl: "https://zvid.example/?room=abc",
  stateLabel: "Sharing, waiting for peer",
};

function noop() {}
const ACTIONS = {
  copyLink: noop,
  showDiagnostics: noop,
  stopShare: noop,
  disconnect: noop,
};

function items(entries: ContextMenuEntry[]) {
  return entries.flatMap((entry) =>
    entry.type === "item"
      ? [{ id: entry.id, label: entry.label, disabled: !!entry.disabled }]
      : [],
  );
}

describe("phoneShareButtonLabel", () => {
  it("says what the control does in each mode", () => {
    assert.equal(phoneShareButtonLabel(IDLE), "Share");
    assert.equal(
      phoneShareButtonLabel({ ...IDLE, isStartingShare: true }),
      "Sharing…",
    );
    assert.equal(phoneShareButtonLabel(SHARING), "Sharing");
    assert.equal(
      phoneShareButtonLabel({ ...SHARING, hasCopiedShareInvite: true }),
      "Copied",
    );
    assert.equal(
      phoneShareButtonLabel({ ...IDLE, mode: "connected" }),
      "Joined",
    );
  });
});

describe("phoneShareSheetEntries", () => {
  it("offers the status, the invite link and Stop Sharing while sharing", () => {
    assert.deepEqual(items(phoneShareSheetEntries(SHARING, ACTIONS)), [
      { id: "status", label: "Sharing, waiting for peer", disabled: true },
      { id: "copy-link", label: "Copy Invite Link", disabled: false },
      { id: "diagnostics", label: "Connection Details…", disabled: false },
      { id: "stop", label: "Stop Sharing", disabled: false },
    ]);
  });

  it("disables Copy Invite Link until the invite is built", () => {
    const copy = items(
      phoneShareSheetEntries({ ...SHARING, shareUrl: "" }, ACTIONS),
    ).find((item) => item.id === "copy-link");
    assert.equal(copy?.disabled, true);
  });

  it("offers Disconnect, not Stop Sharing, to a guest", () => {
    const state = { ...IDLE, mode: "connected" as const, stateLabel: "Live" };
    assert.deepEqual(
      items(phoneShareSheetEntries(state, ACTIONS)).map((item) => item.id),
      ["status", "diagnostics", "disconnect"],
    );
  });

  it("wires each item to its action", () => {
    const calls: string[] = [];
    const entries = phoneShareSheetEntries(SHARING, {
      copyLink: () => calls.push("copy"),
      showDiagnostics: () => calls.push("diagnostics"),
      stopShare: () => calls.push("stop"),
      disconnect: () => calls.push("disconnect"),
    });
    for (const entry of entries) {
      if (entry.type === "item") {
        entry.onSelect?.();
      }
    }
    assert.deepEqual(calls, ["copy", "diagnostics", "stop"]);
  });
});
