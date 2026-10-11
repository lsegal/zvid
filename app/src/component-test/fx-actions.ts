import { type Locator, page, userEvent } from "vitest/browser";

// FX panel actions the e2e specs repeat, on the rendered FxPanel.

export const CLIP_DEVICES = '.fx-chain .fx-device-panel[data-fx-group="clip"]';

// The FX chain's devices in stack `group` ("global", "layer" or "clip").
export function devicesIn(group: string) {
  return [
    ...document.querySelectorAll<HTMLElement>(
      `.fx-chain .fx-device-panel[data-fx-group="${group}"]`,
    ),
  ];
}

// The device panel labeled `name`, in stack `group` when given.
export function device(name: string, group?: string) {
  const scope = group ? `[data-fx-group="${group}"]` : "";
  return page.elementLocator(
    document.querySelector(
      `.fx-chain .fx-device-panel${scope}[aria-label="${name}"]`,
    ) ?? missing(name),
  );
}

function missing(name: string): never {
  throw new Error(`No ${name} device in the FX chain`);
}

// Types `value` into a knob or fader's readout editor, as a double-click
// on the readout opens it.
export async function typeValue(panel: Locator, label: string, value: string) {
  await userEvent.dblClick(
    panel.getByRole("button", { name: new RegExp(`^${label}: `) }),
  );
  await userEvent.fill(
    panel.getByRole("textbox", { name: `${label} value` }),
    value,
  );
  await userEvent.keyboard("{Enter}");
}

// Picks `item` from submenu `category` of the add menu that `button` opens,
// inside the menu's `group` heading ("Audio" or "Video") when given.
export async function addFromMenu(
  button: string,
  category: string,
  item: RegExp | string,
  group?: string,
) {
  await userEvent.click(page.getByRole("button", { name: button }).first());
  const menu = page.getByRole("menu");
  const scope = group ? menu.getByRole("group", { name: group }) : menu;
  // The submenu opens from the keyboard, as in the e2e specs.
  scope
    .getByRole("menuitem", { name: category, exact: true })
    .element()
    .focus();
  await userEvent.keyboard("{ArrowRight}");
  const choice = page.getByRole("menuitem", {
    name: typeof item === "string" ? new RegExp(`^${item}`) : item,
  });
  await userEvent.click(choice);
}
