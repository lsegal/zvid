import { useRef, useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  BASE_QUARTER_PX,
  DEFAULT_LANES,
  signatureById,
} from "../app/constants.ts";
import { getShortcutLabels } from "../app/shortcut-labels.ts";
import type { Lane } from "../app/types.ts";
import { ContextMenu, type MenuPoint } from "../components/ContextMenu";
import { PreviewTextEditor } from "../components/PreviewTextEditor";
import { SessionSettingsDialog } from "../components/SessionSettingsDialog";
import { TopBar } from "../components/TopBar";
import {
  ClipCard,
  type ClipCardContext,
} from "../components/timeline/ClipCard";
import { LayerHeader } from "../components/timeline/LayerHeader";
import { TrackAddButton } from "../components/timeline/TrackPlaceholder";
import {
  TransportHarness,
  textClip,
} from "../components/timeline/transport-test-harness.tsx";
import { IDENTITY_MATRIX } from "../composition-transform.ts";
import { useCollaborationState } from "../hooks/useCollaboration.ts";
import { buildLayerMenuEntries } from "../menus/layer-menu.ts";
import { createPlayheadSignal } from "../playhead-signal.ts";
import { DEFAULT_ROW_METRICS } from "../row-heights.ts";
import { DEFAULT_SESSION_SETTINGS } from "../session-settings.ts";
import { readTextStyle } from "../text-style.ts";
import { useLayerReorder } from "../use-layer-reorder.ts";
import { useSpacePlayback } from "./useSpacePlayback.ts";

// The harness runs useSpacePlayback as App does; importing it here makes
// `vitest --changed` select this file when it changes.
void useSpacePlayback;

// Space toggles playback from any focus, and never opens a menu, presses a
// button or picks up a grip (#745). Text entry is the only exception, where
// Space types a space. Grips and buttons use Enter instead.

const noop = () => {};
const ROW_HEIGHT = DEFAULT_ROW_METRICS.lane.height;
// A text clip on Layer 1 from 40px to 260px in at 100% zoom.
const TEXT_CLIP = textClip(40 / BASE_QUARTER_PX, 220 / BASE_QUARTER_PX / 2);

const CLIP_CARD_CONTEXT: ClipCardContext = {
  selectedClipId: undefined,
  dragState: null,
  bpm: 120,
  quarterPx: BASE_QUARTER_PX,
  visibleTimelineStartPx: 0,
  visibleTimelineWidthPx: 1000,
  signature: signatureById("4/4"),
  mediaItemsById: new Map(),
  thumbnails: { get: () => undefined },
  clipPieces: new Map(),
  clipFilmstrips: new Map(),
  remoteMediaProgress: new Map(),
  timelineEffects: [],
  effects: [],
  prefersReducedMotion: true,
  revealedMediaIds: new Set(),
  shortcutLabels: getShortcutLabels(),
  openArrangementClipMenu: noop,
  startTextEdit: noop,
  setPendingSelection: noop,
  setDragPreviewClips: noop,
  setSelectedClipId: noop,
  setDragState: noop,
};

// The File menu's top bar, with Session Settings… opening its dialog.
function EditorTopBar({ openSettings }: { openSettings: () => void }) {
  const collaboration = useCollaborationState();
  return (
    <TopBar
      canStartNewSession
      collaboration={collaboration}
      exportButtonLabel="Export"
      getEditMenuEntries={() => []}
      handleDisconnectConnection={noop}
      handleImport={async () => {}}
      handleNewSession={noop}
      handleOpenSession={async () => {}}
      handleSaveToLibrary={async () => true}
      handleStopShare={noop}
      isExporting={false}
      offlineMedia={[]}
      openExportDialog={noop}
      renamingLaneIdRef={{ current: undefined }}
      sample={{ handleOpenSample: noop }}
      setIsCaptureInstallerDialogOpen={noop}
      setIsMediaStorageDialogOpen={noop}
      setIsMediaSyncDialogOpen={noop}
      setIsOfflineMediaDialogOpen={noop}
      setIsProjectExportDialogOpen={noop}
      setIsSessionSettingsOpen={openSettings}
      setStatus={noop}
      showShareCopiedBadge={noop}
      showsMediaSync={false}
    />
  );
}

// The arrangement's layer headers, with their grips, menus and rename
// field, and the [ + Layer ] button, as ArrangementLanes lays them out, and
// a text clip that a double-click edits on the canvas.
function Layers() {
  const [lanes, setLanes] = useState<Lane[]>(DEFAULT_LANES);
  const [renamingLaneId, setRenamingLaneId] = useState<string>();
  const [menu, setMenu] = useState<{ anchor: MenuPoint; laneId: string }>();
  const [editingText, setEditingText] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const layerReorder = useLayerReorder({
    lanes,
    listRef,
    scrollRef: listRef,
    onMove: noop,
  });
  const addLayer = () =>
    setLanes((current) => [
      ...current,
      {
        id: String(current.length + 1),
        name: `Layer ${current.length + 1}`,
        colorIndex: -1,
      },
    ]);
  const menuEntries = menu
    ? buildLayerMenuEntries({
        lanes,
        laneId: menu.laneId,
        fxEnabled: true,
        effectCount: 0,
        effects: [],
        actions: {
          rename: () => setRenamingLaneId(menu.laneId),
          duplicate: addLayer,
          remove: noop,
          toggleFx: noop,
          addFx: noop,
          insertAbove: addLayer,
          insertBelow: addLayer,
          moveUp: noop,
          moveDown: noop,
        },
      })
    : [];

  return (
    <div
      className={`arrangement-lanes ${layerReorder.listClassName}`}
      ref={listRef}
    >
      <div
        aria-hidden="true"
        className="layer-drop-indicator"
        ref={layerReorder.indicatorRef}
      />
      <div aria-live="polite" className="layer-reorder-status" role="status">
        {layerReorder.announcement}
      </div>
      {lanes.map((lane, laneIndex) => (
        <section
          className={`track-row ${
            lane.id === layerReorder.liftedLaneId ? "track-row--lifted" : ""
          }`}
          data-layer-row-id={lane.id}
          key={lane.id}
        >
          <LayerHeader
            lane={lane}
            laneIndex={laneIndex}
            fxLaneId="1"
            status={undefined}
            height={ROW_HEIGHT}
            expandedHeight={ROW_HEIGHT}
            layerReorder={layerReorder}
            renamingLaneId={renamingLaneId}
            setRenamingLaneId={setRenamingLaneId}
            readOnly={false}
            openLayerMenu={(event, laneId) => {
              event.preventDefault();
              setMenu({
                anchor: { x: event.clientX, y: event.clientY },
                laneId,
              });
            }}
            selectLaneFromLabel={noop}
            focusLaneLabel={noop}
            commitLayerRename={(laneId, name) => {
              setLanes((current) =>
                current.map((candidate) =>
                  candidate.id === laneId ? { ...candidate, name } : candidate,
                ),
              );
              setRenamingLaneId(undefined);
            }}
            setLayerFxEnabled={noop}
            setLayerHidden={noop}
            toggleRowCollapsed={noop}
            resizeRow={noop}
          />
          <div className="track-row__content" data-timeline-lane-id={lane.id}>
            {lane.id === "1" ? (
              <ClipCard
                clip={TEXT_CLIP}
                {...CLIP_CARD_CONTEXT}
                startTextEdit={() => setEditingText(true)}
              />
            ) : null}
          </div>
        </section>
      ))}
      <section className="track-row track-placeholder track-placeholder--layer">
        <div className="track-label">
          <TrackAddButton
            disabled={false}
            label="Layer"
            onClick={addLayer}
            title="Add a layer"
          />
        </div>
        <div className="track-row__content" />
      </section>
      <ContextMenu
        anchor={menu?.anchor ?? null}
        entries={menuEntries}
        label="Layer header actions"
        onClose={() => setMenu(undefined)}
      />
      {editingText ? (
        <PreviewTextEditor
          canvas={{ width: 1920, height: 1080 }}
          placement={{ width: 400, height: 120, matrix: IDENTITY_MATRIX }}
          style={readTextStyle(undefined)}
          onChangeText={noop}
          onAction={() => setEditingText(false)}
        />
      ) : null}
    </div>
  );
}

// The editor with a text clip on Layer 1, so there is something to play.
function SpaceEditor({ signal = createPlayheadSignal() }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <TransportHarness
        clips={[TEXT_CLIP]}
        header={<EditorTopBar openSettings={() => setSettingsOpen(true)} />}
        playheadSignal={signal}
      >
        <Layers />
      </TransportHarness>
      <SessionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={DEFAULT_SESSION_SETTINGS}
        onApply={noop}
      />
    </>
  );
}

// By label, since an open dialog hides the transport from the
// accessibility tree.
function transportButton(label: string) {
  return document.querySelector(`button[aria-label="${label}"]`);
}

function headerCount() {
  return document.querySelectorAll("[data-layer-header-id]").length;
}

function fileTrigger() {
  return page
    .getByRole("menubar")
    .getByRole("menuitem", { name: "File", exact: true });
}

const pressSpace = () => userEvent.keyboard("[Space]");

// Space starts playback and Space again stops it, from `target`.
async function expectSpaceToggles(target: HTMLElement) {
  target.focus();
  expect(document.activeElement).toBe(target);
  await expect.poll(() => transportButton("Play timeline")).not.toBeNull();
  await pressSpace();
  await expect.poll(() => transportButton("Pause playback")).not.toBeNull();
  expect(document.activeElement).toBe(target);
  await pressSpace();
  await expect.poll(() => transportButton("Play timeline")).not.toBeNull();
}

function openLayerMenu() {
  return userEvent.click(
    document.querySelector('[data-layer-header-id="1"]') as Element,
    { button: "right" },
  );
}

async function renderEditor() {
  const screen = await render(<SpaceEditor />);
  await expect
    .element(screen.getByRole("button", { name: "Reorder Layer 1" }))
    .toBeInTheDocument();
  return screen;
}

describe("useSpacePlayback", () => {
  test("Space toggles playback from buttons, sliders, grips and the menubar", async () => {
    const screen = await renderEditor();
    await expectSpaceToggles(fileTrigger().element() as HTMLElement);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(0);

    const scale = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="Timeline scale"] button',
      ),
    ];
    const selected = scale.findIndex((tab) =>
      tab.classList.contains("is-active"),
    );
    const other = scale[selected === 0 ? 1 : 0];
    await expectSpaceToggles(other);
    expect(other.classList.contains("is-active")).toBe(false);

    const zoom = screen
      .getByRole("slider", { name: "Timeline zoom" })
      .element() as HTMLInputElement;
    const zoomValue = zoom.value;
    await expectSpaceToggles(zoom);
    expect(zoom.value).toBe(zoomValue);

    const volume = screen
      .getByRole("slider", { name: "Preview volume" })
      .element() as HTMLInputElement;
    const volumeValue = volume.value;
    await expectSpaceToggles(volume);
    expect(volume.value).toBe(volumeValue);

    const grip = document.querySelector<HTMLElement>(
      "[data-layer-grip]",
    ) as HTMLElement;
    await expectSpaceToggles(grip);
    expect(grip.getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelectorAll(".track-row--lifted")).toHaveLength(0);

    const count = headerCount();
    const addLayer = document.querySelector<HTMLElement>(
      ".track-placeholder--layer button",
    ) as HTMLElement;
    await expectSpaceToggles(addLayer);
    expect(headerCount()).toBe(count);
  });

  test("Space closes an open menu and toggles playback without picking an item", async () => {
    await renderEditor();
    await fileTrigger().click();
    await expect.element(page.getByRole("menu")).toBeVisible();
    expect(transportButton("Play timeline")).not.toBeNull();
    await pressSpace();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    await expect.poll(() => transportButton("Pause playback")).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await pressSpace();
    await expect.poll(() => transportButton("Play timeline")).not.toBeNull();

    // The layer header's own context menu too.
    await openLayerMenu();
    const layerMenu = page.getByRole("menu", { name: "Layer header actions" });
    await expect.element(layerMenu).toBeVisible();
    const count = headerCount();
    await pressSpace();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    await expect.poll(() => transportButton("Pause playback")).not.toBeNull();
    await pressSpace();
    await expect.poll(() => transportButton("Play timeline")).not.toBeNull();
    expect(headerCount()).toBe(count);
  });

  test("Space toggles playback inside an open dialog without pressing its button", async () => {
    await renderEditor();
    await fileTrigger().click();
    await page
      .getByRole("menuitem", { name: "Session Settings…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Session Settings" });
    await expect.element(dialog).toBeVisible();
    const button = dialog.getByRole("button").first().element() as HTMLElement;
    button.focus();
    expect(transportButton("Play timeline")).not.toBeNull();
    await pressSpace();
    await expect.poll(() => transportButton("Pause playback")).not.toBeNull();
    await expect.element(dialog).toBeVisible();
    await pressSpace();
    await expect.poll(() => transportButton("Play timeline")).not.toBeNull();
    await expect.element(dialog).toBeVisible();
  });

  test("Space types a space in a layer rename field and the text clip editor", async () => {
    const screen = await renderEditor();
    await openLayerMenu();
    await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
    const name = screen.getByRole("textbox", { name: "Layer name" });
    await expect.poll(() => document.activeElement).toBe(name.element());
    await name.fill("Drum");
    await pressSpace();
    await userEvent.keyboard("loop");
    await expect.element(name).toHaveValue("Drum loop");
    expect(transportButton("Play timeline")).not.toBeNull();
    await userEvent.keyboard("{Escape}");

    // Double-clicking the text clip edits it on the canvas.
    await userEvent.dblClick(
      document.querySelector(".clip-card--text .clip-card__body") as Element,
    );
    const editor = screen
      .getByTestId("preview-text-editor")
      .getByRole("textbox");
    await expect.poll(() => document.activeElement).toBe(editor.element());
    await userEvent.keyboard("a");
    await pressSpace();
    await userEvent.keyboard("b");
    await expect.element(editor).toHaveValue("a b");
    expect(transportButton("Play timeline")).not.toBeNull();
  });

  test("Enter picks up a grip and presses [ + Layer ]", async () => {
    await renderEditor();
    const grip = document.querySelector<HTMLElement>(
      "[data-layer-grip]",
    ) as HTMLElement;
    grip.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => grip.getAttribute("aria-pressed")).toBe("true");
    await expect
      .poll(() => document.querySelector(".layer-reorder-status")?.textContent)
      .toContain("Picked up");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => grip.getAttribute("aria-pressed")).toBe("false");

    const count = headerCount();
    const addLayer = document.querySelector<HTMLElement>(
      ".track-placeholder--layer button",
    ) as HTMLElement;
    addLayer.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(headerCount).toBe(count + 1);
  });

  test("Space after playback reaches the end restarts from the start", async () => {
    const signal = createPlayheadSignal();
    await render(<SpaceEditor signal={signal} />);
    // The playhead's position in the lane at 100% zoom.
    const playheadX = () => signal.get() * BASE_QUARTER_PX;
    const startX = playheadX();
    await pressSpace();
    await expect.poll(() => transportButton("Pause playback")).not.toBeNull();
    // Playback stops by itself at the end of the clip.
    await expect
      .poll(() => transportButton("Play timeline"), { timeout: 30_000 })
      .not.toBeNull();
    const endX = playheadX();
    expect(endX).toBeGreaterThan(startX + 50);

    await pressSpace();
    await expect.poll(() => transportButton("Pause playback")).not.toBeNull();
    await expect.poll(playheadX).toBeLessThan(startX + (endX - startX) / 2);
    await pressSpace();
    await expect.poll(() => transportButton("Play timeline")).not.toBeNull();
  });
});
