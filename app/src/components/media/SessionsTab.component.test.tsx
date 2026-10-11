import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { createNewSessionHistory } from "../../app/new-session.ts";
import type { SavedWorkspaceSession } from "../../app/workspace-types.ts";
import { useSessionLibrary } from "../../hooks/useSessionLibrary.ts";
import { getSessionLibraryStore } from "../../session-library.ts";
import { SessionLibraryDialogs, SessionsTab } from "./SessionsTab";
import "./media-drawer.css";

// The Sessions tab lists the Sessions library, kept in IndexedDB. Entries
// rename, duplicate and delete from their context menu, and the changes are
// stored, so they outlive a reload.

const noop = () => {};

// The app's wiring of the library hook to the tab and its dialogs, over a
// blank session with nothing unsaved, inside the open drawer that
// media-drawer.css styles.
function SessionsHost() {
  const library = useSessionLibrary({
    projectHistory: createNewSessionHistory(),
    hasUnsavedChanges: false,
    setHasUnsavedChanges: noop,
    sessionSource: { kind: "none" },
    setSessionSource: noop,
    readWorkspaceSession: () => {
      throw new Error("not saving in this test");
    },
    openWorkspaceSession: (_session: SavedWorkspaceSession) => {},
    refuseReadOnlyEdit: () => false,
    setStatus: noop,
  });
  return (
    <>
      <div className="media-drawer-column is-open">
        <aside aria-label="Sessions" className="media-drawer">
          <div className="media-drawer__panel">
            <SessionsTab closeButton={null} library={library} />
          </div>
        </aside>
      </div>
      <SessionLibraryDialogs library={library} />
    </>
  );
}

async function storedNames() {
  const entries = await getSessionLibraryStore().list();
  return entries.map((entry) => entry.name).sort();
}

function entries() {
  return page.getByRole("list", { name: "Sessions" }).getByRole("button");
}

function entry(name: string) {
  return entries().filter({ hasText: name });
}

async function openEntryMenu(name: string, item: string) {
  await entry(name).click({ button: "right" });
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

beforeEach(async () => {
  const store = getSessionLibraryStore();
  for (const { id } of await store.list()) {
    await store.delete(id);
  }
});

describe("SessionsTab", () => {
  test("says when there are no sessions yet", async () => {
    await render(<SessionsHost />);
    await expect.element(page.getByText("No sessions yet")).toBeVisible();
  });

  test("entries rename, duplicate and delete from their context menu", async () => {
    const now = Date.now();
    await getSessionLibraryStore().put({
      id: "saved-1",
      name: "Untitled Session",
      createdAt: now,
      updatedAt: now,
      clipCount: 0,
      payload: "{}",
    });
    await render(<SessionsHost />);
    await expect.element(entry("Untitled Session")).toBeVisible();
    expect(
      entry("Untitled Session").element().querySelector(".media-row__kind")
        ?.textContent,
    ).toBe("0 clips");

    await openEntryMenu("Untitled Session", "Rename…");
    const name = page.getByRole("textbox", { name: "Session name" });
    await name.fill("Demo");
    await userEvent.keyboard("{Enter}");
    await expect.element(entry("Demo")).toBeVisible();

    await openEntryMenu("Demo", "Duplicate");
    await expect.element(entry("Demo copy")).toBeVisible();
    expect(entries().elements()).toHaveLength(2);

    await openEntryMenu("Demo copy", "Delete…");
    const confirm = page.getByRole("dialog", { name: "Delete Demo copy?" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect.element(entry("Demo copy")).not.toBeInTheDocument();
    expect(entries().elements()).toHaveLength(1);

    // What a reload would list.
    expect(await storedNames()).toEqual(["Demo"]);
  });
});
