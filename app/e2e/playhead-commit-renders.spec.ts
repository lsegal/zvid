import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

// Playback moves the playhead signal every frame and commits it to React
// state only at clip edges. A commit re-renders the app, but must not
// re-render the timeline's clip rows (#947). A four-second test pattern at
// 120 BPM spans eight quarters; two of them back to back put a clip edge
// in the middle of playback.
const VIDEO = new URL("./fixtures/test-pattern.mp4", import.meta.url);

type RenderCounts = {
  commits: number;
  renders: Record<string, number>;
  // The props that changed for each row component that re-rendered.
  changedProps: Record<string, string[]>;
};

// Counts, through the React DevTools hook, the commits and the renders of
// each timeline row component, which are told apart by their props since
// the production build minifies their names. A component rendered in a
// commit when its committed props are a new object; one memo() skipped
// keeps the old object.
async function installRenderCounter(page: Page) {
  await page.addInitScript(() => {
    type Fiber = {
      tag: number;
      key: string | null;
      memoizedProps: Record<string, unknown> | null;
      child: Fiber | null;
      sibling: Fiber | null;
    };
    const rows: Record<string, [string, string]> = {
      ClipCard: ["clip", "openArrangementClipMenu"],
      SourceSpan: ["clip", "selectSourceSpan"],
      LaneRow: ["lane", "clipCard"],
      SourceTrackRow: ["track", "span"],
    };
    const counts: RenderCounts = {
      commits: 0,
      renders: {},
      changedProps: {},
    };
    const seenProps = new WeakSet<object>();
    const lastProps = new Map<string, Record<string, unknown>>();
    const FUNCTION_COMPONENT = 0;
    const SIMPLE_MEMO_COMPONENT = 15;

    const visit = (fiber: Fiber) => {
      const props = fiber.memoizedProps;
      if (
        (fiber.tag === FUNCTION_COMPONENT ||
          fiber.tag === SIMPLE_MEMO_COMPONENT) &&
        props &&
        typeof props === "object" &&
        !seenProps.has(props)
      ) {
        seenProps.add(props);
        for (const [name, keys] of Object.entries(rows)) {
          if (!keys.every((key) => key in props)) {
            continue;
          }
          const id = `${name}:${fiber.key}`;
          const previous = lastProps.get(id);
          lastProps.set(id, props);
          if (!previous) {
            continue;
          }
          counts.renders[name] = (counts.renders[name] ?? 0) + 1;
          const changed = Object.keys(props).filter(
            (key) => previous[key] !== props[key],
          );
          counts.changedProps[name] = [
            ...new Set([...(counts.changedProps[name] ?? []), ...changed]),
          ];
        }
      }
      for (let child = fiber.child; child; child = child.sibling) {
        visit(child);
      }
    };

    const probe = window as unknown as {
      renderCounts: RenderCounts;
      __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown;
    };
    probe.renderCounts = counts;
    probe.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onScheduleFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        counts.commits += 1;
        visit(root.current);
      },
    };
  });
}

function readRenderCounts(page: Page) {
  return page.evaluate(
    () => (window as unknown as { renderCounts: RenderCounts }).renderCounts,
  );
}

function resetRenderCounts(page: Page) {
  return page.evaluate(() => {
    const counts = (window as unknown as { renderCounts: RenderCounts })
      .renderCounts;
    counts.commits = 0;
    counts.renders = {};
    counts.changedProps = {};
  });
}

async function dropVideoIntoNewSourceTrack(page: Page) {
  const base64 = (await readFile(VIDEO)).toString("base64");
  const dataTransfer = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([bytes], "test-pattern.mp4", { type: "video/mp4" }),
    );
    return transfer;
  }, base64);
  const target = '[data-source-track-drop-target="new-track"]';
  for (const type of ["dragenter", "dragover", "drop"]) {
    await page.dispatchEvent(target, type, { dataTransfer });
  }
  await expect(page.locator(".source-span")).toHaveCount(1, {
    timeout: 30_000,
  });
}

// The playhead's position within the lanes, independent of scroll.
function playheadX(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector(
      ".timeline-playhead-marker",
    ) as HTMLElement;
    const content = document.querySelector(
      "[data-timeline-lane-id]",
    ) as HTMLElement;
    return (
      marker.getBoundingClientRect().left - content.getBoundingClientRect().left
    );
  });
}

test.use({ viewport: { width: 1600, height: 1200 } });

test("a playhead commit during playback doesn't re-render clip rows", async ({
  page,
}) => {
  await installRenderCounter(page);
  await page.goto("/");
  await expect(page.locator("[data-timeline-lane-id]").first()).toBeVisible();
  await dropVideoIntoNewSourceTrack(page);
  // Ctrl/Cmd-click drops the source clip on the arrangement, selected, and
  // Duplicate puts a copy right after it.
  await page.locator(".source-span").click({ modifiers: ["ControlOrMeta"] });
  const clips = page.locator(".clip-card");
  await expect(clips).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+D");
  await expect(clips).toHaveCount(2);
  await expect(page.locator(".preview-placeholder")).toHaveCount(0, {
    timeout: 30_000,
  });
  const [firstBox, secondBox, laneBox] = await Promise.all([
    clips.nth(0).boundingBox(),
    clips.nth(1).boundingBox(),
    page.locator("[data-timeline-lane-id]").first().boundingBox(),
  ]);
  if (!firstBox || !secondBox || !laneBox) {
    throw new Error("timeline is not visible");
  }
  const edgeX = Math.max(firstBox.x, secondBox.x) - laneBox.x;
  expect(Math.abs(firstBox.x - secondBox.x)).toBeGreaterThan(40);
  expect(await playheadX(page)).toBeLessThan(edgeX - 40);

  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();
  // Past starting playback, through the edge between the clips.
  await page.waitForTimeout(500);
  await resetRenderCounts(page);
  await expect
    .poll(() => playheadX(page), { timeout: 10_000 })
    .toBeGreaterThan(edgeX + 20);
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeVisible();

  const counts = await readRenderCounts(page);
  // The edge committed the playhead...
  expect(counts.commits).toBeGreaterThan(0);
  // ...without re-rendering a clip row.
  expect(counts.changedProps).toEqual({});
  expect(counts.renders).toEqual({});
});
