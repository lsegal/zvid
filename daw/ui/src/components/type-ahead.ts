import type { Camera } from "../ipc/types.ts";

/**
 * The first camera at or after `from` (wrapping) whose name starts with
 * `query`, ignoring case; -1 when none does.
 */
export function typeAheadMatch(
  cameras: Camera[],
  query: string,
  from: number,
): number {
  const wanted = query.toLocaleLowerCase();
  for (let offset = 0; offset < cameras.length; offset++) {
    const index = (from + offset) % cameras.length;
    if (cameras[index].name.toLocaleLowerCase().startsWith(wanted)) {
      return index;
    }
  }
  return -1;
}
