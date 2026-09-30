import type { StatusItemProvider } from "../registry.ts";

export const sessionStatusItem: StatusItemProvider = {
  id: "session",
  order: 20,
  items: (state) => {
    const sessionName = state.sessionName ?? "Untitled session";
    return [
      {
        id: "session",
        label: "Session",
        value: sessionName,
        title: `Session: ${sessionName}`,
      },
    ];
  },
};
