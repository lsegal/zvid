import { describe, expect, test } from "vitest";
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
});
