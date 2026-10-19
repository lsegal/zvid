import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import {
  EDITOR_TEST_TIMEOUT,
  renderEditor,
} from "../../component-test/editor.tsx";
import {
  center,
  click,
  down,
  holdModifiers,
  move,
  undo,
  up,
} from "../../component-test/input.ts";
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

  // There is no snap grid selector, only the Snap On/Off toggle, with the
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
    const snap = screen.getByRole("button", { name: "Snap On" });
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

  // Dragging the BPM readout travels the 60–220 range over 200px, like the
  // zoom readout: 50px up from 120 lands on 160, and down on 80.
  async function dragTempo(dy: number) {
    const readout = document.querySelector(
      ".tempo-pill__readout",
    ) as HTMLElement;
    const { x, y } = center(readout);
    await move(x, y);
    await down();
    await move(x, y + dy, { steps: 10 });
    const during = readout.textContent;
    await up();
    return { readout, during };
  }

  test("dragging the BPM readout up raises the tempo live and commits one undo step", async () => {
    await renderEditor();
    const { readout, during } = await dragTempo(-50);
    expect(during).toBe("160 BPM");
    await expect.poll(() => readout.textContent).toBe("160 BPM");

    await undo();
    await expect.poll(() => readout.textContent).toBe("120 BPM");
  });

  test("dragging the BPM readout down lowers the tempo, clamped to the range", async () => {
    await renderEditor();
    const { readout } = await dragTempo(50);
    await expect.poll(() => readout.textContent).toBe("80 BPM");
    await dragTempo(100);
    await expect.poll(() => readout.textContent).toBe("60 BPM");
  });

  test("Shift-dragging the BPM readout is ten times finer", async () => {
    await renderEditor();
    holdModifiers(["Shift"]);
    const { readout } = await dragTempo(-50);
    await expect.poll(() => readout.textContent).toBe("124 BPM");
  });

  test("a plain click on the BPM readout leaves the tempo alone", async () => {
    await renderEditor();
    const readout = document.querySelector(
      ".tempo-pill__readout",
    ) as HTMLElement;
    const { x, y } = center(readout);
    await click(x, y);
    expect(readout.textContent).toBe("120 BPM");
  });
});
