import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextMenuEntry } from "../context-menu.ts";
import { buildFileMenuEntries, type FileMenuInputs } from "./file-menu.ts";

const noop = () => {};

function inputs(overrides: Partial<FileMenuInputs> = {}): FileMenuInputs {
  return {
    canStartNewSession: true,
    handleNewSession: noop,
    handleOpenSession: async () => {},
    sample: { openSample: noop },
    handleImport: async () => {},
    offlineMedia: [],
    showsMediaSync: false,
    collaboration: {
      isConnectedClient: false,
      setIsConnectDialogOpen: noop,
    },
    handleDisconnectConnection: noop,
    handleSaveToLibrary: async () => true,
    isExporting: false,
    openExportDialog: noop,
    setIsMediaStorageDialogOpen: noop,
    setIsMediaSyncDialogOpen: noop,
    setIsOfflineMediaDialogOpen: noop,
    setIsProjectExportDialogOpen: noop,
    setIsSessionSettingsOpen: noop,
    ...overrides,
  };
}

function outline(entries: readonly ContextMenuEntry[]): unknown[] {
  return entries.map((entry) =>
    entry.type === "separator"
      ? "---"
      : entry.submenu
        ? { [entry.label]: outline(entry.submenu) }
        : `${entry.label}${entry.disabled ? " (disabled)" : ""}`,
  );
}

function item(entries: readonly ContextMenuEntry[], id: string) {
  const found = entries.find(
    (entry) => entry.type === "item" && entry.id === id,
  );
  assert.ok(found?.type === "item", `no ${id} item`);
  return found;
}

describe("File menu", () => {
  it("lists the desktop File menu's items in order", () => {
    assert.deepEqual(outline(buildFileMenuEntries(inputs())), [
      "New Session",
      { Open: ["Session…", { Samples: ["Default", "MIDI"] }] },
      "Import Media",
      "All Media Linked (disabled)",
      "Media Storage…",
      "Session Settings…",
      "---",
      "Connect to Share",
      "---",
      "Save",
      { Export: ["Video…", "Project…"] },
    ]);
  });

  it("follows the session's state", () => {
    const entries = buildFileMenuEntries(
      inputs({
        canStartNewSession: false,
        offlineMedia: [{}],
        showsMediaSync: true,
        isExporting: true,
        collaboration: {
          isConnectedClient: true,
          setIsConnectDialogOpen: noop,
        },
      }),
    );
    assert.deepEqual(outline(entries), [
      "New Session (disabled)",
      { Open: ["Session…", { Samples: ["Default", "MIDI"] }] },
      "Import Media",
      "Locate Offline Media…",
      "Media Storage…",
      "Session Settings…",
      "Media Sync Status…",
      "---",
      "Disconnect from Share",
      "---",
      "Save",
      { Export: ["Video… (disabled)", "Project…"] },
    ]);
  });

  it("runs each item's action", () => {
    const calls: string[] = [];
    const record = (name: string) => () => {
      calls.push(name);
    };
    const entries = buildFileMenuEntries(
      inputs({
        handleNewSession: record("new"),
        handleOpenSession: async () => record("open")(),
        sample: { openSample: (id) => record(`sample ${id}`)() },
        handleImport: async () => record("import")(),
        collaboration: {
          isConnectedClient: false,
          setIsConnectDialogOpen: record("connect"),
        },
        handleSaveToLibrary: async () => {
          record("save")();
          return true;
        },
        openExportDialog: record("export"),
      }),
    );
    const open = item(entries, "open").submenu ?? [];
    const samples = item(open, "open-samples").submenu ?? [];
    const exports = item(entries, "export").submenu ?? [];
    for (const selected of [
      item(entries, "new-session"),
      item(open, "open-session"),
      item(samples, "open-sample-default"),
      item(samples, "open-sample-midi"),
      item(entries, "import-media"),
      item(entries, "connect"),
      item(entries, "save"),
      item(exports, "export-video"),
    ]) {
      selected.onSelect?.();
    }
    assert.deepEqual(calls, [
      "new",
      "open",
      "sample default",
      "sample midi",
      "import",
      "connect",
      "save",
      "export",
    ]);
  });

  it("shows only the shortcuts it is given", () => {
    const entries = buildFileMenuEntries(inputs(), { save: "Ctrl+S" });
    assert.equal(item(entries, "save").shortcut, "Ctrl+S");
    assert.equal(item(entries, "new-session").shortcut, undefined);
    assert.equal(
      item(buildFileMenuEntries(inputs()), "save").shortcut,
      undefined,
    );
  });
});
