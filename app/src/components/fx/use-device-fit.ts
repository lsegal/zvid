import {
  createContext,
  type RefObject,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { resolveDeviceFit } from "../../fx-device-fit.ts";

// The height a device in the FX chain should keep within, or null where the
// page or a sheet scrolls and devices keep their usual layout.
export const FxDeviceMaxHeightContext = createContext<number | null>(null);

const NO_HEIGHTS: readonly number[] = [];

// A device's height without the stretch the chain gives it.
function naturalHeight(element: HTMLElement) {
  const { alignSelf } = element.style;
  element.style.alignSelf = "flex-start";
  const height = element.offsetHeight;
  element.style.alignSelf = alignSelf;
  return height;
}

// Which of a device's `layoutCount` layouts to show: the first that fits the
// chain's height. Each layout is rendered and measured before paint the first
// time it's needed, and `signature` names what its heights depend on. Disabled,
// as a folded device is, it stays on its usual layout.
export function useDeviceFit(
  ref: RefObject<HTMLElement | null>,
  signature: string,
  layoutCount: number,
  enabled = true,
) {
  const maxHeight = useContext(FxDeviceMaxHeightContext);
  const [measured, setMeasured] = useState({
    signature,
    heights: NO_HEIGHTS,
  });
  const heights =
    measured.signature === signature ? measured.heights : NO_HEIGHTS;
  const { layout, measure } = resolveDeviceFit(
    heights,
    enabled ? maxHeight : null,
    layoutCount,
  );

  useLayoutEffect(() => {
    if (measure && ref.current) {
      const height = naturalHeight(ref.current);
      setMeasured({ signature, heights: [...heights, height] });
    }
  });

  return layout;
}
