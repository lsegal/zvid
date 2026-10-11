import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import AppRoot from "../../AppRoot.tsx";
import { usePhone } from "../../component-test/viewport.ts";

test("smoke", async () => {
  await usePhone();
  const screen = await render(<AppRoot />);
  await expect.element(screen.getByRole("navigation", { name: "Editor" })).toBeVisible();
  const shell = document.querySelector(".app-shell");
  console.log(shell?.className, document.documentElement.scrollHeight, innerHeight);
  console.log(JSON.stringify(document.querySelector(".timeline-panel")?.getBoundingClientRect()));
});
