import {
  DocumentIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import type { ContextMenuEntry, MenuPoint } from "../../context-menu.ts";
import type { SessionLibraryState } from "../../hooks/useSessionLibrary.ts";
import {
  formatSessionTime,
  type SessionLibrarySummary,
} from "../../session-library.ts";
import { ContextMenu } from "../ContextMenu";
import { NameInput } from "../NameInput";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { filterMediaItems } from "./media-drawer-model.ts";
import "./sessions-tab.css";

type SessionsTabProps = {
  library: SessionLibraryState;
  // The drawer's close button, shown at the right of the title.
  closeButton: ReactNode;
};

function formatSessionCount(shown: number, total: number, searching: boolean) {
  const noun = total === 1 ? "session" : "sessions";
  return searching ? `${shown} of ${total} ${noun}` : `${total} ${noun}`;
}

// The Media drawer's Sessions tab: every session in the Sessions library,
// newest first. A click opens one; its context menu renames, duplicates or
// deletes it.
export function SessionsTab({ library, closeButton }: SessionsTabProps) {
  const { entries, currentEntryId } = library;
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string>();
  const [menu, setMenu] = useState<{
    anchor: MenuPoint;
    entry: SessionLibrarySummary;
  } | null>(null);
  const searching = query.trim() !== "";
  const visibleEntries = useMemo(
    () => filterMediaItems(entries, query),
    [entries, query],
  );

  function openMenu(
    entry: SessionLibrarySummary,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    // A keyboard-opened menu has no pointer position; open it at the row.
    const anchor =
      event.clientX || event.clientY
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.left + 24, y: rect.bottom };
    setMenu({ anchor, entry });
  }

  function getMenuEntries(entry: SessionLibrarySummary): ContextMenuEntry[] {
    return [
      {
        type: "item",
        id: "open",
        label: "Open",
        onSelect: () => library.openEntry(entry),
      },
      { type: "separator" },
      {
        type: "item",
        id: "rename",
        label: "Rename…",
        onSelect: () => setRenamingId(entry.id),
      },
      {
        type: "item",
        id: "duplicate",
        label: "Duplicate",
        onSelect: () => void library.duplicateEntry(entry.id),
      },
      { type: "separator" },
      {
        type: "item",
        id: "delete",
        label: "Delete…",
        onSelect: () => library.requestDelete(entry),
      },
    ];
  }

  function renderEntry(entry: SessionLibrarySummary) {
    const current = entry.id === currentEntryId;
    const time = formatSessionTime(entry.updatedAt);
    const clips = `${entry.clipCount} ${entry.clipCount === 1 ? "clip" : "clips"}`;
    const icon = (
      <span className="media-thumb session-row__icon" aria-hidden="true">
        <DocumentIcon className="media-thumb__glyph" />
      </span>
    );
    if (renamingId === entry.id) {
      return (
        <li className="media-row session-row is-renaming" key={entry.id}>
          {icon}
          <NameInput
            initialName={entry.name}
            label="Session name"
            onCancel={() => setRenamingId(undefined)}
            onSubmit={(name) => {
              setRenamingId(undefined);
              void library.renameEntry(entry.id, name);
            }}
          />
          <span className="media-row__kind">{clips}</span>
          <span className="media-row__duration">{time}</span>
        </li>
      );
    }
    return (
      <li key={entry.id}>
        <button
          aria-current={current ? "true" : undefined}
          className={`media-row session-row${current ? " is-current" : ""}`}
          data-session-id={entry.id}
          onClick={() => library.openEntry(entry)}
          onContextMenu={(event) => openMenu(entry, event)}
          onKeyDown={(event) => {
            if (event.key === "F2") {
              event.preventDefault();
              event.stopPropagation();
              setRenamingId(entry.id);
            }
          }}
          title={`Open ${entry.name}`}
          type="button"
        >
          {icon}
          <span className="media-row__name">
            <span className="media-row__label">{entry.name}</span>
            {current ? (
              <span className="media-badge session-row__badge">Open</span>
            ) : null}
          </span>
          <span className="media-row__kind">{clips}</span>
          <span className="media-row__duration">{time}</span>
        </button>
      </li>
    );
  }

  return (
    <>
      <div className="media-drawer__record-header media-drawer__sessions-header">
        <h2 className="media-drawer__record-title">Sessions</h2>
        {closeButton}
      </div>
      <div className="media-drawer__search">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          aria-label="Search sessions"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="Search"
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label="Clear search"
            className="media-drawer__clear"
            onClick={() => setQuery("")}
            type="button"
          >
            <XMarkIcon aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="media-drawer__content">
        <div className="media-drawer__body">
          {entries.length === 0 ? (
            <div className="media-drawer__empty">
              <span>No sessions yet</span>
              <button
                className="ghost-button ghost-button--accent"
                onClick={() => void library.saveToLibrary()}
                type="button"
              >
                Save Current Session
              </button>
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="media-drawer__empty">
              <span>No sessions match “{query.trim()}”</span>
            </div>
          ) : (
            <>
              <div
                aria-hidden="true"
                className="media-row media-row--head session-row--head"
              >
                <span />
                <span>Name</span>
                <span>Clips</span>
                <span>Modified</span>
              </div>
              <ul
                aria-label="Sessions"
                className="media-drawer__list session-list"
              >
                {visibleEntries.map(renderEntry)}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="media-drawer__status">
        <span className="media-drawer__count" aria-live="polite">
          {formatSessionCount(visibleEntries.length, entries.length, searching)}
        </span>
      </div>

      <ContextMenu
        anchor={menu?.anchor ?? null}
        entries={menu ? getMenuEntries(menu.entry) : []}
        label="Session actions"
        onClose={() => setMenu(null)}
      />
    </>
  );
}

// Asks before opening a library entry over unsaved changes, and before
// deleting one.
export function SessionLibraryDialogs({
  library,
}: {
  library: SessionLibraryState;
}) {
  const { pendingOpen, pendingDelete } = library;
  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (!open) void library.resolvePendingOpen("cancel");
        }}
        open={pendingOpen !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save changes to this session?</DialogTitle>
            <DialogDescription>
              Opening {pendingOpen?.name ?? "another session"} replaces this
              one. Changes that aren't saved will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button className="ghost-button" type="button">
                Cancel
              </button>
            </DialogClose>
            <button
              className="ghost-button"
              onClick={() => void library.resolvePendingOpen("discard")}
              type="button"
            >
              Don't Save
            </button>
            <button
              className="ghost-button ghost-button--accent"
              onClick={() => void library.resolvePendingOpen("save")}
              type="button"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => {
          if (!open) library.cancelDelete();
        }}
        open={pendingDelete !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {pendingDelete?.name}?</DialogTitle>
            <DialogDescription>
              This removes the session from Sessions. Its media stays in the
              media cache. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button className="ghost-button" type="button">
                Cancel
              </button>
            </DialogClose>
            <button
              className="ghost-button ghost-button--accent"
              onClick={() => void library.confirmDelete()}
              type="button"
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
