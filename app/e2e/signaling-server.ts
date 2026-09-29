import type { AddressInfo } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";

// A local y-webrtc signaling server (the same subscribe/publish protocol as
// ../signaling and y-webrtc's bin/server.js), so browser tests don't depend on
// a public relay.
export async function startSignalingServer() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const topics = new Map<string, Set<WebSocket>>();

  server.on("connection", (socket) => {
    const subscribed = new Set<string>();
    socket.on("message", (raw) => {
      let message: {
        type?: unknown;
        topic?: unknown;
        topics?: unknown;
        clients?: number;
      };
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (message.type) {
        case "subscribe":
          for (const topic of Array.isArray(message.topics)
            ? message.topics
            : []) {
            if (typeof topic === "string") {
              const receivers = topics.get(topic) ?? new Set();
              receivers.add(socket);
              topics.set(topic, receivers);
              subscribed.add(topic);
            }
          }
          break;
        case "unsubscribe":
          for (const topic of Array.isArray(message.topics)
            ? message.topics
            : []) {
            topics.get(topic)?.delete(socket);
            subscribed.delete(topic);
          }
          break;
        case "publish": {
          const receivers =
            typeof message.topic === "string"
              ? topics.get(message.topic)
              : undefined;
          if (receivers) {
            message.clients = receivers.size;
            const data = JSON.stringify(message);
            for (const receiver of receivers) {
              receiver.send(data);
            }
          }
          break;
        }
        case "ping":
          socket.send(JSON.stringify({ type: "pong" }));
          break;
      }
    });
    socket.on("close", () => {
      for (const topic of subscribed) {
        topics.get(topic)?.delete(socket);
      }
    });
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) {
          client.terminate();
        }
        server.close(() => resolve());
      }),
  };
}
