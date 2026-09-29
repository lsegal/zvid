import { expect, test } from "@playwright/test";

// Share invites in the real app: the link keeps the page origin, carries the
// password in the fragment, and a joining page scrubs the password from the
// address bar after reading it.

test("copies an invite that points at the page origin", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Start Sharing" }).click();

  // Served from localhost, so the status warns the link is local-only.
  await expect(
    page.getByText("only works on this computer or network", { exact: false }),
  ).toBeVisible();

  const invite = new URL(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(invite.origin).toBe(new URL(page.url()).origin);
  expect(invite.searchParams.get("room")).toBeTruthy();
  expect(invite.searchParams.has("password")).toBe(false);
});

test("reads the password from the fragment and clears it", async ({ page }) => {
  await page.goto("/?room=e2eroom#password=s3cret");

  await expect.poll(() => new URL(page.url()).hash).toBe("");
  const url = new URL(page.url());
  expect(url.searchParams.get("room")).toBe("e2eroom");
  expect(url.searchParams.has("password")).toBe(false);
});

test("still reads the password from the query of old links", async ({
  page,
}) => {
  await page.goto("/?room=e2eroom&password=s3cret");

  await expect
    .poll(() => new URL(page.url()).searchParams.has("password"))
    .toBe(false);
  expect(new URL(page.url()).searchParams.get("room")).toBe("e2eroom");
});
