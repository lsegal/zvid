import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMediaBinDropTarget,
  isMediaDrawerSpringTarget,
  MEDIA_DRAWER_SPRING_EDGE_PX,
} from "./media-drawer-drop.ts";

// A stand-in element inside the elements `selectors` match.
const within = (...selectors: string[]) =>
  ({
    closest: (selector: string) => (selectors.includes(selector) ? {} : null),
  }) as unknown as EventTarget;

const TIMELINE = { left: 200, top: 100, bottom: 500 };

describe("isMediaBinDropTarget", () => {
  it("is the Media tab marked as taking drops", () => {
    assert.equal(
      isMediaBinDropTarget(within("[data-media-bin-drop-target]")),
      true,
    );
    assert.equal(isMediaBinDropTarget(within(".media-drawer-column")), false);
    assert.equal(isMediaBinDropTarget(null), false);
  });
});

describe("isMediaDrawerSpringTarget", () => {
  it("springs over the drawer column, whatever its tab", () => {
    assert.equal(
      isMediaDrawerSpringTarget(within(".media-drawer-column"), 0, 0, TIMELINE),
      true,
    );
  });

  it("springs left of the timeline and along its left edge", () => {
    assert.equal(isMediaDrawerSpringTarget(within(), 10, 300, TIMELINE), true);
    assert.equal(
      isMediaDrawerSpringTarget(
        within(),
        TIMELINE.left + MEDIA_DRAWER_SPRING_EDGE_PX - 1,
        300,
        TIMELINE,
      ),
      true,
    );
  });

  it("does not spring further into the timeline or above or below it", () => {
    assert.equal(
      isMediaDrawerSpringTarget(
        within(),
        TIMELINE.left + MEDIA_DRAWER_SPRING_EDGE_PX,
        300,
        TIMELINE,
      ),
      false,
    );
    assert.equal(isMediaDrawerSpringTarget(within(), 10, 50, TIMELINE), false);
    assert.equal(isMediaDrawerSpringTarget(within(), 10, 600, TIMELINE), false);
    assert.equal(
      isMediaDrawerSpringTarget(within(), 10, 300, undefined),
      false,
    );
  });
});
