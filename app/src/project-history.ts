export type ProjectHistoryEntry<State> = {
  snapshot: State;
  label: string;
};

export type ProjectHistoryState<State> = {
  past: ProjectHistoryEntry<State>[];
  present: State;
  future: ProjectHistoryEntry<State>[];
  // State before the first `transient` update of an in-progress gesture
  // (such as a knob drag). The `commit` that ends the gesture records it as
  // the undo snapshot, so the whole gesture is a single history entry.
  transientBase?: State;
};

export type ProjectHistoryAction<State> =
  | {
      type: "commit";
      label: string;
      updater: (current: State) => State;
    }
  | {
      type: "transient";
      updater: (current: State) => State;
    }
  | {
      type: "undo";
    }
  | {
      type: "redo";
    }
  | {
      type: "replace";
      snapshot: State;
    };

export function createProjectHistoryState<State>(
  initial: State,
): ProjectHistoryState<State> {
  return {
    past: [],
    present: initial,
    future: [],
  };
}

export function projectHistoryReducer<State>(
  state: ProjectHistoryState<State>,
  action: ProjectHistoryAction<State>,
): ProjectHistoryState<State> {
  switch (action.type) {
    case "commit": {
      const base = state.transientBase ?? state.present;
      const next = action.updater(state.present);
      if (next === base) {
        return state.transientBase === undefined
          ? state
          : { past: state.past, present: next, future: state.future };
      }

      return {
        past: [...state.past, { snapshot: base, label: action.label }],
        present: next,
        future: [],
      };
    }

    case "transient": {
      const next = action.updater(state.present);
      if (next === state.present) {
        return state;
      }

      return {
        ...state,
        present: next,
        transientBase: state.transientBase ?? state.present,
      };
    }

    case "undo": {
      const previousEntry = state.past[state.past.length - 1];
      if (!previousEntry) {
        return state;
      }

      return {
        past: state.past.slice(0, -1),
        present: previousEntry.snapshot,
        future: [
          { snapshot: state.present, label: previousEntry.label },
          ...state.future,
        ],
      };
    }

    case "redo": {
      const nextEntry = state.future[0];
      if (!nextEntry) {
        return state;
      }

      return {
        past: [
          ...state.past,
          { snapshot: state.present, label: nextEntry.label },
        ],
        present: nextEntry.snapshot,
        future: state.future.slice(1),
      };
    }

    case "replace": {
      if (state.present === action.snapshot) {
        return state;
      }

      return {
        past: [],
        present: action.snapshot,
        future: [],
      };
    }

    default:
      return state;
  }
}
