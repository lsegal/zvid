import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { renderTimelineEditor } from "../../component-test/timeline-editor.tsx";
import { TimelineToolbar } from "./TimelineToolbar";

// The toolbar renders in the timeline editor, whose ruler it switches.
describe(TimelineToolbar, () => {
  // The scale toggle: Tempo shows bar numbers on the ruler, Time shows
  // timecode.
  test("the scale toggle reads Tempo / Time and switches the ruler", async () => {
    const screen = await renderTimelineEditor();
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
    const screen = await renderTimelineEditor();
    const toolbar = screen.container.querySelector(
      ".timeline-toolbar",
    ) as HTMLElement;
    expect(screen.getByRole("tablist", { name: "Snap grid" }).elements()).toEqual(
      [],
    );
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
      snap.element().parentElement?.nextElementSibling?.classList.contains(
        "tempo-pill",
      ),
    ).toBe(true);

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
});
