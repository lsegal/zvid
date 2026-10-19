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

  // Clicking the transport readout swaps the scale like the toggle does,
  // undoably, and works from the keyboard (#1515).
  test("the playhead readout swaps the time mode", async () => {
    const screen = await renderEditor();
    const readout = screen.getByRole("button", { name: "Swap time mode" });
    const tempo = screen.getByRole("button", { name: "Tempo", exact: true });
    const time = screen.getByRole("button", { name: "Time", exact: true });
    const firstLabel = () =>
      screen.container.querySelector(".ruler-marker span")?.textContent;
    await expect.element(readout).toHaveTextContent("00:00:001.1.1");
    await expect.element(tempo).toHaveClass(/is-active/);

    await readout.click();
    await expect.element(time).toHaveClass(/is-active/);
    await expect.poll(firstLabel).toBe("00:00:00");
    await expect.element(readout).toHaveTextContent("00:00:001.1.1");

    await userEvent.keyboard("{Control>}z{/Control}");
    await expect.element(tempo).toHaveClass(/is-active/);
    await expect.poll(firstLabel).toBe("1");

    readout.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(time).toHaveClass(/is-active/);
    await expect.poll(firstLabel).toBe("00:00:00");
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

  // The time signature steps along a ladder like the zoom buttons and takes
  // any typed N/M (#1521), and the ruler's bars follow it.
  test("the time signature steps the ladder and takes a typed N/M", async () => {
    const screen = await renderEditor();
    const field = screen.getByRole("textbox", { name: "Time signature" });
    const previous = screen.getByRole("button", {
      name: "Previous time signature",
    });
    const next = screen.getByRole("button", { name: "Next time signature" });
    // At 100% a quarter is 28px wide.
    const barPx = () => {
      const [first, second] =
        screen.container.querySelectorAll<HTMLElement>(".ruler-marker");
      return second.offsetLeft - first.offsetLeft;
    };
    await expect.element(field).toHaveValue("4/4");
    expect(barPx()).toBe(112);

    await next.click();
    await expect.element(field).toHaveValue("4/5");
    await previous.click();
    await previous.click();
    await expect.element(field).toHaveValue("4/3");

    await field.fill("7/5");
    await userEvent.keyboard("{Enter}");
    await expect.element(field).toHaveValue("7/5");
    await expect.poll(barPx).toBeCloseTo(156.8, 0);

    // Off the ladder, and committed on blur.
    await field.fill("13/8");
    await next.click();
    await expect.element(field).toHaveValue("13/8");
    await expect.element(next).toBeDisabled();
    await expect.poll(barPx).toBeCloseTo(182, 0);

    // Arrow keys in the field step too.
    await field.click();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(field).toHaveValue("12/8");

    // What doesn't parse, or is abandoned with Escape, puts the current
    // signature back.
    await field.fill("fast");
    await userEvent.keyboard("{Enter}");
    await expect.element(field).toHaveValue("12/8");
    await field.fill("3/4");
    await userEvent.keyboard("{Escape}");
    await expect.element(field).toHaveValue("12/8");

    await (field.element() as HTMLInputElement).blur();
    await userEvent.keyboard("{Control>}z{/Control}");
    await expect.element(field).toHaveValue("13/8");
  });

  test("the time signature stops at the ends of the ladder", async () => {
    const screen = await renderEditor({ project: { signatureId: "1/1" } });
    const field = screen.getByRole("textbox", { name: "Time signature" });
    await expect.element(field).toHaveValue("1/1");
    await expect
      .element(screen.getByRole("button", { name: "Previous time signature" }))
      .toBeDisabled();
    await field.fill("12/8");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("button", { name: "Next time signature" }))
      .toBeDisabled();
  });

  // The Snap toggle always reads "Snap"; its state shows only through the
  // active styling and aria-pressed (#1517).
  test("the Snap toggle keeps its label when toggled", async () => {
    const screen = await renderEditor();
    const snap = screen.getByRole("button", { name: "Snap", exact: true });
    expect(snap.element().textContent).toBe("Snap");
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
