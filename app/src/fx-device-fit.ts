// Which layout a device uses for the height the FX chain offers. Layouts are
// ordered from the device's usual one to its widest and shortest, and their
// heights are measured once, so the choice depends only on the height offered,
// which never depends on the devices: it can't flip back and forth with a row
// that fits its content.

// How many layouts of a device have been tried, and which to show. `measure`
// asks for the next layout's height, while none measured so far fits. When
// none fits at all, it stays on the first of the shortest, so a device that
// can't get any shorter, such as Levels, isn't widened for nothing.
export function resolveDeviceFit(
  heights: readonly number[],
  maxHeight: number | null,
  layoutCount: number,
) {
  if (maxHeight === null) {
    return { layout: 0, measure: false };
  }
  const fitting = heights.findIndex((height) => height <= maxHeight);
  if (fitting >= 0) {
    return { layout: fitting, measure: false };
  }
  if (heights.length < layoutCount) {
    return { layout: heights.length, measure: true };
  }
  return { layout: heights.indexOf(Math.min(...heights)), measure: false };
}

// What's left for a device in the panel's body: the row's height without the
// panel's own header and border, and the chain's padding and scrollbar. With
// no resized height the row fits its content up to `fitCap`, and the devices
// are held to that cap rather than to the row's current height, which depends
// on them.
export function getDeviceMaxHeight({
  resizedRow,
  fitCap,
  panelChrome,
  chainChrome,
}: {
  resizedRow: number | null;
  fitCap: number;
  panelChrome: number;
  chainChrome: number;
}) {
  return (resizedRow ?? fitCap) - panelChrome - chainChrome;
}
