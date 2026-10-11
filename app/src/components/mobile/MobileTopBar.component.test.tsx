import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { PhoneShell } from "../../component-test/shells.tsx";
import { usePhone } from "../../component-test/viewport.ts";
import type { MobileShareButtonProps } from "./MobileShareButton";
import { MobileTopBar } from "./MobileTopBar";

// The phone top bar's Export and Share controls (#1175) at the narrowest
// portrait width the shell targets.
const NARROW_PHONE = { width: 375, height: 667 } as const;

const noop = () => {};

function share(
  collaboration: Partial<MobileShareButtonProps["collaboration"]> = {},
): MobileShareButtonProps {
  return {
    collaboration: {
      collaborationMode: "idle",
      collaborationView: {
        stateLabel: "Not connected",
        stateTone: "idle",
      } as MobileShareButtonProps["collaboration"]["collaborationView"],
      hasCopiedShareInvite: false,
      isStartingShare: false,
      setIsDiagnosticsDialogOpen: noop,
      setIsShareDialogOpen: noop,
      shareUrl: "",
      ...collaboration,
    },
    sharing: {
      handleDisconnectConnection: noop,
      handleStopShare: noop,
      showShareCopiedBadge: noop,
    },
  };
}

// A share started and waiting for its first peer, as the collaboration
// controller reports it.
const SHARING = share({
  collaborationMode: "sharing",
  collaborationView: {
    stateLabel: "Sharing, waiting for peer",
    stateTone: "waiting",
  } as MobileShareButtonProps["collaboration"]["collaborationView"],
  shareUrl: "https://zvid.example/#share=room",
});

async function renderTopBar(shareProps = share()) {
  await usePhone(NARROW_PHONE);
  return render(
    <PhoneShell>
      <MobileTopBar
        exportSupport="supported"
        getMenuEntries={() => []}
        historyEntries={[
          { type: "item", id: "undo", label: "Undo", disabled: true },
          { type: "item", id: "redo", label: "Redo", disabled: true },
        ]}
        isExporting={false}
        isMenuOpen={false}
        onExport={noop}
        onOpenSessions={noop}
        sessionName={null}
        setIsMenuOpen={noop}
        share={shareProps}
      />
    </PhoneShell>,
  );
}

function topBar() {
  const bar = document.querySelector(".mobile-topbar");
  if (!bar) throw new Error("no .mobile-topbar");
  return bar;
}

function shareButton() {
  const button = topBar().querySelector(".mobile-share-button");
  if (!button) throw new Error("no .mobile-share-button");
  return button as HTMLButtonElement;
}

// Every control sits inside the bar, in order, without overlapping.
function expectNothingClipped() {
  const boxes = Array.from(
    topBar().querySelectorAll(":scope > button, :scope > h1"),
  ).map((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      clipped:
        element.tagName === "BUTTON" &&
        element.scrollWidth > element.clientWidth,
    };
  });
  expect(boxes).toHaveLength(7);
  for (const [index, box] of boxes.entries()) {
    expect(box.clipped).toBe(false);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(NARROW_PHONE.width);
    if (index > 0) {
      expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1].right);
    }
  }
}

describe("MobileTopBar", () => {
  test("Export and Share are labeled and fit a 375px top bar", async () => {
    const screen = await renderTopBar();
    const exportButton = screen.getByRole("button", { name: /^Export/ });
    expect(exportButton.element().textContent).toBe("Export");
    expect(shareButton().textContent).toBe("Share");
    await expect.element(shareButton()).toHaveAccessibleName("Share");
    expectNothingClipped();

    // A long session name ellipsizes instead of pushing either one out.
    const title = topBar().querySelector("h1") as HTMLElement;
    title.textContent =
      "A very long session name that cannot fit next to the controls";
    expectNothingClipped();
    await expect.element(exportButton).toBeVisible();
    await expect.element(shareButton()).toBeVisible();
  });

  // The control turns into the share's state, still fitting the bar.
  test("a live share's state still fits the 375px top bar", async () => {
    await renderTopBar(SHARING);
    expect(shareButton().dataset.collaborationMode).toBe("sharing");
    await expect
      .element(shareButton())
      .toHaveAccessibleName(/: Sharing, waiting for peer$/);
    expectNothingClipped();
  });
});
