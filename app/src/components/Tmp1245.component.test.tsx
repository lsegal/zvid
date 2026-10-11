import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

// Temporary: checks that CI uploads failure screenshots (#1245).
test("fails on purpose", async () => {
  await render(<button type="button">Hi</button>);
  await expect
    .element(page.getByRole("button", { name: "Nope" }), { timeout: 300 })
    .toBeVisible();
});
