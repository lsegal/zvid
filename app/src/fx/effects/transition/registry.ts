// The Transition types, from the files in types/ (see type.ts), in menu
// order.
import type { TransitionOption } from "./type.ts";
import { TRANSITION_TYPE_MODULES } from "./types/index.generated.ts";

export const TRANSITION_TYPES = [...TRANSITION_TYPE_MODULES].sort(
  (left, right) => left.menuOrder - right.menuOrder,
);

export const DEFAULT_TRANSITION_TYPE =
  TRANSITION_TYPES.find((type) => type.name === "Dissolve") ??
  TRANSITION_TYPES[0];

// The type named `name`, case-insensitively; the default for a name no type
// has, such as one a newer build saved.
export function findTransitionType(name: string | undefined) {
  const wanted = name?.trim().toLowerCase();
  return (
    TRANSITION_TYPES.find((type) => type.name.toLowerCase() === wanted) ??
    DEFAULT_TRANSITION_TYPE
  );
}

// The names of the types that use `option`, which the device shows it for.
export function typesUsing(option: TransitionOption) {
  return TRANSITION_TYPES.filter((type) => type.options?.includes(option)).map(
    (type) => type.name,
  );
}
