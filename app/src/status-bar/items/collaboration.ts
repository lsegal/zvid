import { plural } from "../plural.ts";
import type { StatusItemProvider } from "../registry.ts";

// The share state, while sharing or joined.
export const collaborationStatusItem: StatusItemProvider = {
  id: "collaboration",
  order: 70,
  items: ({ collaboration }) => {
    if (collaboration.mode === "idle") {
      return [];
    }

    const role = collaboration.mode === "sharing" ? "Sharing" : "Joined";
    let value: string;
    let detail: string;
    if (collaboration.peerCount > 0) {
      value = `${role} · ${plural(collaboration.peerCount, "peer")}`;
      detail = `${plural(collaboration.peerCount, "peer")} connected`;
    } else if (collaboration.connected) {
      value = `${role} · waiting`;
      detail =
        collaboration.mode === "sharing"
          ? "waiting for a peer"
          : "waiting for the host";
    } else {
      value = "Connecting…";
      detail = "connecting to the signaling server";
    }

    return [
      {
        id: "collaboration",
        label: "Collab",
        value,
        title: `Collaboration: ${
          collaboration.mode === "sharing" ? "sharing this session" : "joined"
        }, ${detail}`,
      },
    ];
  },
};
