import type { InheritedSourceStack } from "../../app/fx-panel-model.ts";
import "./inherited-source-fx.css";

// The source stacks the selected layer clip inherits, listed read-only
// ahead of its own stack, where they apply (see
// composition-source-effects.ts). They are edited on the source track and
// source clip themselves.
export function InheritedSourceFx({
  stacks,
}: {
  stacks: readonly InheritedSourceStack[];
}) {
  return (
    <section
      aria-label="Inherited from source"
      className="fx-inherited"
      data-fx-inherited=""
    >
      <h3 className="fx-inherited__title">From source</h3>
      {stacks.map((stack) => (
        <div className="fx-inherited__stack" key={stack.stackId}>
          <h4 className="fx-inherited__name">{stack.name}</h4>
          <ul aria-label={`${stack.name} effects`}>
            {stack.effects.map((effect) => (
              <li
                className={
                  effect.enabled
                    ? "fx-inherited__effect"
                    : "fx-inherited__effect fx-inherited__effect--off"
                }
                key={effect.id}
              >
                {effect.name}
                {effect.enabled ? null : (
                  <span className="fx-inherited__off"> (off)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="fx-inherited__hint">Edit on the source</p>
    </section>
  );
}
