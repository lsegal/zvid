import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../../component-test/editor.tsx";
import { TimelineToolbar } from "./TimelineToolbar";

// The toolbar renders in the timeline editor, whose ruler it switches.
describe(TimelineToolbar, { timeout: EDITOR_TEST_TIMEOUT }, () => {
  // The scale toggle: Tempo shows bar numbers on the ruler, Time shows
  // timecode.
  test("the scale toggle reads Tempo / Time and switches the ruler", async () => {
    const screen = await renderEditor();
    const tempo = screen.getByRole("button", { name: "Tempo", exact: true });
    const time = screen.getByRole("button", { name: "Time", exact: true });
    const firstLabel = () =>
      screen.container.querySelector(".ruler-marker span")?.textContent;
    await expect.element(tempo).toBeVisible();
    await expect.element(time).toBeVisible();
    expect(getComputedStyle(time.element()).textTransform).toBe("uppercase");
    expect(screen.getByRole("button", { name: "SMPTE" }).elements()).toEqual(
      [],
    );

    await expect.element(tempo).toHaveClass(/is-active/);
    expect(firstLabel()).toBe("1");

    await time.click();
    await expect.element(time).toHaveClass(/is-active/);
    await expect.element(tempo).not.toHaveClass(/is-active/);
    await expect.poll(firstLabel).toBe("00:00:00");

    await tempo.click();
    await expect.element(tempo).toHaveClass(/is-active/);
    await expect.poll(firstLabel).toBe("1");
  });

  // There is no snap grid selector, only the Snap toggle, with the
  // tempo control right of it (#732).
  test("the toolbar has no snap grid selector and the tempo sits right of Snap", async () => {
    const screen = await renderEditor();
    const toolbar = screen.container.querySelector(
      ".timeline-toolbar",
    ) as HTMLElement;
    expect(
      screen.getByRole("tablist", { name: "Snap grid" }).elements(),
    ).toEqual([]);
    expect(
      [...toolbar.querySelectorAll("button")].filter((button) =>
        /^Auto/.test(button.textContent ?? ""),
      ),
    ).toEqual([]);

    // The tempo control directly follows the Snap toggle's group.
    const snap = screen.getByRole("button", { name: "Snap", exact: true });
    await expect.element(snap).toBeVisible();
    const tempos = toolbar.querySelectorAll(".tempo-pill");
    expect(tempos).toHaveLength(1);
    expect(
      snap
        .element()
        .parentElement?.nextElementSibling?.classList.contains("tempo-pill"),
    ).toBe(true);
    expect(document.querySelectorAll(".topbar .tempo-pill")).toHaveLength(0);

    // −/+ still step the tempo, with undo.
    const tempo = tempos[0] as HTMLElement;
    const tempoText = () => tempo.textContent;
    expect(tempoText()).toContain("120 BPM");
    await screen.getByRole("button", { name: "Increase tempo" }).click();
    await expect.poll(tempoText).toContain("125 BPM");
    const decrease = screen.getByRole("button", { name: "Decrease tempo" });
    await decrease.click();
    await expect.poll(tempoText).toContain("120 BPM");
    await decrease.click();
    await expect.poll(tempoText).toContain("115 BPM");
    await userEvent.keyboard("{Control>}z{/Control}");
    await expect.poll(tempoText).toContain("120 BPM");
  });

  // The Snap toggle always reads "Snap"; its state shows only through the
  // active styling and aria-pressed (#1517). A decorative icon sits left of
  // the label (#1523).
  test("the Snap toggle keeps its label when toggled", async () => {
    const screen = await renderEditor();
    const snap = screen.getByRole("button", { name: "Snap", exact: true });
    expect(snap.element().textContent).toBe("Snap");
    const icon = snap.element().querySelector("svg") as SVGElement;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(snap.element().firstElementChild).toBe(icon);
    const label = document.createRange();
    label.selectNodeContents(snap.element().lastChild as Node);
    expect(icon.getBoundingClientRect().right).toBeLessThanOrEqual(
      label.getBoundingClientRect().left,
    );
    await expect.element(snap).toHaveAttribute("aria-pressed", "true");
    await expect.element(snap).toHaveClass(/is-active/);

    await snap.click();
    await expect.element(snap).toHaveAttribute("aria-pressed", "false");
    await expect.element(snap).not.toHaveClass(/is-active/);
    expect(snap.element().textContent).toBe("Snap");
    await expect
      .element(snap)
      .toHaveAttribute(
        "title",
        "Shift while dragging a clip or trim handle to temporarily disable snapping.",
      );
  });
});
