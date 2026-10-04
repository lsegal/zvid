// Prop comparison for memo() on timeline rows, whose props include a context
// object shared by every row (such as a lane's `clipCard`). App builds that
// object afresh on each render, so it is compared by its fields instead of
// by identity.
export function arePropsEqualWithContexts<Props extends object>(
  ...contextKeys: (keyof Props)[]
) {
  return (previous: Props, next: Props) => {
    const keys = Object.keys(next) as (keyof Props)[];
    if (keys.length !== Object.keys(previous).length) {
      return false;
    }
    return keys.every((key) =>
      contextKeys.includes(key)
        ? areShallowEqual(
            previous[key] as Record<string, unknown>,
            next[key] as Record<string, unknown>,
          )
        : Object.is(previous[key], next[key]),
    );
  };
}

export function areShallowEqual(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  if (Object.is(previous, next)) {
    return true;
  }
  const keys = Object.keys(next);
  return (
    keys.length === Object.keys(previous).length &&
    keys.every(
      (key) =>
        Object.hasOwn(previous, key) && Object.is(previous[key], next[key]),
    )
  );
}
