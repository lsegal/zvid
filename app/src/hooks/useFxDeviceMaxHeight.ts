import { type RefObject, useLayoutEffect, useState } from "react";
import { FX_PANEL_RESERVED_HEIGHT } from "../app/constants.ts";
import { getDeviceMaxHeight } from "../fx-device-fit.ts";

// The layouts where the page scrolls and the panel fits its content, as in
// fx-panel.css.
const STACKED_LAYOUT = "(max-width: 900px), (max-height: 559px)";
// The row's fit-content(40%) in fx-panel.css.
const FIT_ROW_SHARE = 0.4;

// The chain's horizontal scrollbar, which takes room where scrollbars do
// (Linux, Windows) whether or not it's showing yet: the chain only overflows
// once devices have widened, and they shouldn't need another reflow then.
function scrollbarHeight(chain: HTMLElement) {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;height:40px;overflow-x:scroll;scrollbar-width:${getComputedStyle(chain).scrollbarWidth}`;
  chain.append(probe);
  const height = probe.offsetHeight - probe.clientHeight;
  probe.remove();
  return height;
}

function measureMaxHeight(body: HTMLElement, resizedHeight: number | null) {
  const panel = body.parentElement;
  const workspace = panel?.parentElement;
  const chain = body.querySelector<HTMLElement>(":scope > .fx-chain");
  if (!panel || !workspace || !chain || matchMedia(STACKED_LAYOUT).matches) {
    return null;
  }
  const workspaceHeight = workspace.clientHeight;
  const { paddingTop, paddingBottom } = getComputedStyle(chain);
  return getDeviceMaxHeight({
    resizedRow:
      resizedHeight === null
        ? null
        : Math.min(resizedHeight, workspaceHeight - FX_PANEL_RESERVED_HEIGHT),
    fitCap: Math.floor(workspaceHeight * FIT_ROW_SHARE),
    panelChrome: panel.offsetHeight - body.offsetHeight,
    chainChrome:
      Number.parseFloat(paddingTop) +
      Number.parseFloat(paddingBottom) +
      scrollbarHeight(chain),
  });
}

// The height the FX panel's devices should keep within, for the panel's body
// `bodyRef`: from the workspace and the resized height alone, never from the
// panel's current height. Null when the panel can't be resized, as on a phone,
// in the stacked layouts and while it's collapsed.
export function useFxDeviceMaxHeight(
  bodyRef: RefObject<HTMLElement | null>,
  resizable: boolean,
  resizedHeight: number | null,
  collapsed: boolean,
) {
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const workspace = body?.parentElement?.parentElement;
    if (!body || !workspace || !resizable || collapsed) {
      setMaxHeight(null);
      return;
    }
    const update = () => setMaxHeight(measureMaxHeight(body, resizedHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [bodyRef, resizable, resizedHeight, collapsed]);

  return maxHeight;
}
