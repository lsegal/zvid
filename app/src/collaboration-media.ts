import type { WebrtcProvider } from "y-webrtc";

export type MediaResolver = (mediaId: string) => Promise<Blob | null>;

export type MediaRequestOptions = {
  signal?: AbortSignal;
  onProgress?(received: number, total: number): void;
};

export type MediaTransport = {
  requestMedia(
    mediaId: string,
    options?: MediaRequestOptions,
  ): Promise<Blob | null>;
  readonly mediaPeerCount: number;
  destroy(): void;
};

type MediaTransportOptions = {
  provider: WebrtcProvider;
  resolveMedia?: MediaResolver;
  onChange(): void;
  log?(event: string, payload?: unknown): void;
};

type ControlMessage =
  | { t: "hello"; ack?: boolean }
  | { t: "want"; req: number; id: string }
  | { t: "cancel"; req: number }
  | { t: "meta"; req: number; size: number; type: string }
  | { t: "miss"; req: number }
  | { t: "end"; req: number }
  | { t: "err"; req: number; message: string };

const CHANNEL_LABEL = "zvid-media";
// Fixed high id so it never collides with simple-peer's auto-assigned channel.
const CHANNEL_ID = 1001;
const CHUNK_SIZE = 64 * 1024;
const READ_SIZE = 16 * CHUNK_SIZE;
const HEADER_SIZE = 4;
const BUFFERED_LOW_THRESHOLD = 1024 * 1024;
const BUFFERED_HIGH_THRESHOLD = 4 * 1024 * 1024;
const CHANNEL_OPEN_TIMEOUT_MS = 5000;
const TRANSFER_STALL_TIMEOUT_MS = 15000;
const MAX_OUTGOING_TRANSFERS = 2;

type SimplePeerLike = {
  connected: boolean;
  destroyed: boolean;
  _pc: RTCPeerConnection | null;
  on(event: "connect" | "close", listener: () => void): void;
  removeListener(event: "connect" | "close", listener: () => void): void;
};

/**
 * y-webrtc does not expose its peer connections, and its own data channel only
 * accepts y-protocols messages. Media rides on a separate negotiated channel on
 * the same RTCPeerConnection, so we reach into `provider.room.webrtcConns` for
 * each simple-peer instance (`conn.peer`) and its connection (`peer._pc`).
 * BroadcastChannel peers (`room.bcConns`) share IndexedDB and are skipped.
 */
function getWebrtcPeers(provider: WebrtcProvider) {
  const peers = new Map<string, SimplePeerLike>();
  provider.room?.webrtcConns.forEach((conn, peerId) => {
    peers.set(peerId, conn.peer as SimplePeerLike);
  });
  return peers;
}

type IncomingTransfer = {
  resolve(blob: Blob | null): void;
  reject(error: unknown): void;
  onProgress?(received: number, total: number): void;
  chunks: ArrayBuffer[];
  received: number;
  size: number;
  type: string;
  hasMeta: boolean;
  stallTimer: number;
};

type OutgoingTransfer = {
  req: number;
  id: string;
  cancelled: boolean;
};

type MediaPeer = {
  peerId: string;
  peer: SimplePeerLike;
  channel: RTCDataChannel | null;
  ready: boolean;
  closed: boolean;
  readyWaiters: Set<{ resolve(): void; reject(error: unknown): void }>;
  incoming: Map<number, IncomingTransfer>;
  outgoing: Map<number, OutgoingTransfer>;
  queue: OutgoingTransfer[];
  activeOutgoing: number;
  onConnect(): void;
  onClose(): void;
};

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function parseControlMessage(data: string): ControlMessage | null {
  try {
    const message = JSON.parse(data) as ControlMessage;
    return message && typeof message === "object" && "t" in message
      ? message
      : null;
  } catch {
    return null;
  }
}

export function createMediaTransport(
  options: MediaTransportOptions,
): MediaTransport {
  const { provider } = options;
  const log = options.log ?? (() => {});
  const peers = new Map<string, MediaPeer>();
  let nextReq = 1;
  let destroyed = false;

  const send = (mediaPeer: MediaPeer, data: string | ArrayBuffer) => {
    const channel = mediaPeer.channel;
    if (!channel || channel.readyState !== "open") {
      return false;
    }
    try {
      // RTCDataChannel.send is overloaded per payload type.
      if (typeof data === "string") {
        channel.send(data);
      } else {
        channel.send(data);
      }
      return true;
    } catch {
      return false;
    }
  };

  const sendControl = (mediaPeer: MediaPeer, message: ControlMessage) =>
    send(mediaPeer, JSON.stringify(message));

  const finishIncoming = (mediaPeer: MediaPeer, req: number) => {
    const transfer = mediaPeer.incoming.get(req);
    if (!transfer) {
      return undefined;
    }
    window.clearTimeout(transfer.stallTimer);
    mediaPeer.incoming.delete(req);
    return transfer;
  };

  const armStallTimer = (
    mediaPeer: MediaPeer,
    req: number,
    transfer: IncomingTransfer,
  ) => {
    window.clearTimeout(transfer.stallTimer);
    transfer.stallTimer = window.setTimeout(() => {
      if (finishIncoming(mediaPeer, req)) {
        sendControl(mediaPeer, { t: "cancel", req });
        transfer.reject(new Error("Media transfer stalled."));
      }
    }, TRANSFER_STALL_TIMEOUT_MS);
  };

  const closePeer = (mediaPeer: MediaPeer, reason: Error) => {
    if (mediaPeer.closed) {
      return;
    }
    const wasReady = mediaPeer.ready;
    mediaPeer.closed = true;
    mediaPeer.ready = false;
    mediaPeer.peer.removeListener("connect", mediaPeer.onConnect);
    mediaPeer.peer.removeListener("close", mediaPeer.onClose);
    if (mediaPeer.channel) {
      mediaPeer.channel.onopen = null;
      mediaPeer.channel.onmessage = null;
      mediaPeer.channel.onclose = null;
      mediaPeer.channel.close();
    }
    for (const waiter of mediaPeer.readyWaiters) {
      waiter.reject(reason);
    }
    mediaPeer.readyWaiters.clear();
    for (const req of Array.from(mediaPeer.incoming.keys())) {
      finishIncoming(mediaPeer, req)?.reject(reason);
    }
    for (const transfer of mediaPeer.outgoing.values()) {
      transfer.cancelled = true;
    }
    mediaPeer.outgoing.clear();
    mediaPeer.queue.length = 0;
    if (peers.get(mediaPeer.peerId) === mediaPeer) {
      peers.delete(mediaPeer.peerId);
    }
    if (wasReady && !destroyed) {
      options.onChange();
    }
  };

  const markReady = (mediaPeer: MediaPeer) => {
    if (mediaPeer.ready) {
      return;
    }
    mediaPeer.ready = true;
    for (const waiter of mediaPeer.readyWaiters) {
      waiter.resolve();
    }
    mediaPeer.readyWaiters.clear();
    options.onChange();
  };

  const waitForBufferedAmount = (channel: RTCDataChannel) =>
    new Promise<void>((resolve) => {
      if (
        channel.readyState !== "open" ||
        channel.bufferedAmount <= BUFFERED_HIGH_THRESHOLD
      ) {
        resolve();
        return;
      }
      const done = () => {
        channel.removeEventListener("bufferedamountlow", done);
        channel.removeEventListener("close", done);
        resolve();
      };
      channel.addEventListener("bufferedamountlow", done);
      channel.addEventListener("close", done);
    });

  const serveTransfer = async (
    mediaPeer: MediaPeer,
    transfer: OutgoingTransfer,
  ) => {
    const { req } = transfer;
    let blob: Blob | null = null;
    try {
      blob = options.resolveMedia
        ? await options.resolveMedia(transfer.id)
        : null;
    } catch (error) {
      sendControl(mediaPeer, {
        t: "err",
        req,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (transfer.cancelled) {
      return;
    }
    if (!blob) {
      log("collaboration:media:serve:miss", {
        peerId: mediaPeer.peerId,
        mediaId: transfer.id,
      });
      sendControl(mediaPeer, { t: "miss", req });
      return;
    }
    log("collaboration:media:serve:start", {
      peerId: mediaPeer.peerId,
      mediaId: transfer.id,
      size: blob.size,
    });
    if (
      !sendControl(mediaPeer, {
        t: "meta",
        req,
        size: blob.size,
        type: blob.type,
      })
    ) {
      return;
    }

    for (let offset = 0; offset < blob.size; offset += READ_SIZE) {
      const buffer = new Uint8Array(
        await blob.slice(offset, offset + READ_SIZE).arrayBuffer(),
      );
      for (let start = 0; start < buffer.byteLength; start += CHUNK_SIZE) {
        const channel = mediaPeer.channel;
        if (transfer.cancelled || !channel) {
          return;
        }
        await waitForBufferedAmount(channel);
        if (transfer.cancelled) {
          return;
        }
        const payload = buffer.subarray(start, start + CHUNK_SIZE);
        const frame = new Uint8Array(HEADER_SIZE + payload.byteLength);
        new DataView(frame.buffer).setUint32(0, req);
        frame.set(payload, HEADER_SIZE);
        if (!send(mediaPeer, frame.buffer)) {
          return;
        }
      }
    }
    sendControl(mediaPeer, { t: "end", req });
    log("collaboration:media:serve:end", {
      peerId: mediaPeer.peerId,
      mediaId: transfer.id,
    });
  };

  const pumpOutgoing = (mediaPeer: MediaPeer) => {
    while (
      !mediaPeer.closed &&
      mediaPeer.activeOutgoing < MAX_OUTGOING_TRANSFERS &&
      mediaPeer.queue.length > 0
    ) {
      const transfer = mediaPeer.queue.shift() as OutgoingTransfer;
      mediaPeer.activeOutgoing += 1;
      void serveTransfer(mediaPeer, transfer)
        .catch(() => {
          sendControl(mediaPeer, {
            t: "err",
            req: transfer.req,
            message: "Failed to send media.",
          });
        })
        .finally(() => {
          mediaPeer.activeOutgoing -= 1;
          mediaPeer.outgoing.delete(transfer.req);
          pumpOutgoing(mediaPeer);
        });
    }
  };

  const handleControlMessage = (
    mediaPeer: MediaPeer,
    message: ControlMessage,
  ) => {
    switch (message.t) {
      case "hello":
        if (!message.ack) {
          sendControl(mediaPeer, { t: "hello", ack: true });
        }
        markReady(mediaPeer);
        return;
      case "want": {
        if (
          typeof message.req !== "number" ||
          typeof message.id !== "string" ||
          mediaPeer.outgoing.has(message.req)
        ) {
          return;
        }
        const transfer = { req: message.req, id: message.id, cancelled: false };
        mediaPeer.outgoing.set(transfer.req, transfer);
        mediaPeer.queue.push(transfer);
        pumpOutgoing(mediaPeer);
        return;
      }
      case "cancel": {
        const transfer = mediaPeer.outgoing.get(message.req);
        if (transfer) {
          transfer.cancelled = true;
          mediaPeer.outgoing.delete(message.req);
          const queued = mediaPeer.queue.indexOf(transfer);
          if (queued >= 0) {
            mediaPeer.queue.splice(queued, 1);
          }
        }
        return;
      }
      case "meta": {
        const transfer = mediaPeer.incoming.get(message.req);
        if (!transfer) {
          return;
        }
        if (
          typeof message.size !== "number" ||
          !Number.isSafeInteger(message.size) ||
          message.size < 0
        ) {
          finishIncoming(mediaPeer, message.req);
          sendControl(mediaPeer, { t: "cancel", req: message.req });
          transfer.reject(new Error("Invalid media metadata."));
          return;
        }
        transfer.hasMeta = true;
        transfer.size = message.size;
        transfer.type = typeof message.type === "string" ? message.type : "";
        transfer.onProgress?.(0, transfer.size);
        armStallTimer(mediaPeer, message.req, transfer);
        return;
      }
      case "miss":
        finishIncoming(mediaPeer, message.req)?.resolve(null);
        return;
      case "end": {
        const transfer = finishIncoming(mediaPeer, message.req);
        if (!transfer) {
          return;
        }
        if (!transfer.hasMeta || transfer.received !== transfer.size) {
          transfer.reject(
            new Error(
              `Media transfer size mismatch: received ${transfer.received} of ${transfer.size} bytes.`,
            ),
          );
          return;
        }
        transfer.resolve(new Blob(transfer.chunks, { type: transfer.type }));
        return;
      }
      case "err":
        finishIncoming(mediaPeer, message.req)?.reject(
          new Error(
            typeof message.message === "string" && message.message
              ? message.message
              : "Peer failed to send media.",
          ),
        );
        return;
    }
  };

  const handleDataMessage = (mediaPeer: MediaPeer, data: ArrayBuffer) => {
    if (data.byteLength < HEADER_SIZE) {
      return;
    }
    const req = new DataView(data).getUint32(0);
    const transfer = mediaPeer.incoming.get(req);
    if (!transfer?.hasMeta) {
      return;
    }
    const payloadSize = data.byteLength - HEADER_SIZE;
    if (transfer.received + payloadSize > transfer.size) {
      finishIncoming(mediaPeer, req);
      sendControl(mediaPeer, { t: "cancel", req });
      transfer.reject(new Error("Media transfer exceeded announced size."));
      return;
    }
    transfer.chunks.push(data.slice(HEADER_SIZE));
    transfer.received += payloadSize;
    transfer.onProgress?.(transfer.received, transfer.size);
    armStallTimer(mediaPeer, req, transfer);
  };

  const openChannel = (mediaPeer: MediaPeer) => {
    const pc = mediaPeer.peer._pc;
    if (mediaPeer.closed || mediaPeer.channel || !pc) {
      return;
    }
    // Both sides create the same negotiated channel once simple-peer's own
    // channel is up, so the SCTP association already exists and no SDP
    // renegotiation is needed.
    let channel: RTCDataChannel;
    try {
      channel = pc.createDataChannel(CHANNEL_LABEL, {
        negotiated: true,
        id: CHANNEL_ID,
        ordered: true,
      });
    } catch {
      return;
    }
    mediaPeer.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFERED_LOW_THRESHOLD;
    // The remote side may not have created its end yet when ours opens, so
    // peers exchange a hello/ack before either sends requests.
    const sayHello = () => sendControl(mediaPeer, { t: "hello" });
    channel.onopen = sayHello;
    channel.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        const message = parseControlMessage(event.data);
        if (message) {
          handleControlMessage(mediaPeer, message);
        }
      } else if (event.data instanceof ArrayBuffer) {
        handleDataMessage(mediaPeer, event.data);
      }
    };
    channel.onclose = () => {
      closePeer(mediaPeer, new Error("Media channel closed."));
    };
    if (channel.readyState === "open") {
      sayHello();
    }
  };

  const attachPeer = (peerId: string, peer: SimplePeerLike) => {
    const mediaPeer: MediaPeer = {
      peerId,
      peer,
      channel: null,
      ready: false,
      closed: false,
      readyWaiters: new Set(),
      incoming: new Map(),
      outgoing: new Map(),
      queue: [],
      activeOutgoing: 0,
      onConnect: () => openChannel(mediaPeer),
      onClose: () => closePeer(mediaPeer, new Error("Peer disconnected.")),
    };
    peers.set(peerId, mediaPeer);
    peer.on("close", mediaPeer.onClose);
    if (peer.connected) {
      openChannel(mediaPeer);
    } else {
      peer.on("connect", mediaPeer.onConnect);
    }
  };

  const syncPeers = () => {
    if (destroyed) {
      return;
    }
    const current = getWebrtcPeers(provider);
    for (const mediaPeer of Array.from(peers.values())) {
      if (current.get(mediaPeer.peerId) !== mediaPeer.peer) {
        closePeer(mediaPeer, new Error("Peer disconnected."));
      }
    }
    for (const [peerId, peer] of current) {
      if (!peers.has(peerId) && !peer.destroyed) {
        attachPeer(peerId, peer);
      }
    }
  };

  const waitForReady = (mediaPeer: MediaPeer, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (mediaPeer.ready) {
        resolve();
        return;
      }
      if (mediaPeer.closed) {
        reject(new Error("Peer disconnected."));
        return;
      }
      const cleanup = () => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        mediaPeer.readyWaiters.delete(waiter);
      };
      const waiter = {
        resolve() {
          cleanup();
          resolve();
        },
        reject(error: unknown) {
          cleanup();
          reject(error);
        },
      };
      const onAbort = () => waiter.reject(abortReason(signal as AbortSignal));
      const timer = window.setTimeout(
        () => waiter.reject(new Error("Media channel did not open in time.")),
        CHANNEL_OPEN_TIMEOUT_MS,
      );
      signal?.addEventListener("abort", onAbort);
      mediaPeer.readyWaiters.add(waiter);
    });

  const requestFromPeer = (
    mediaPeer: MediaPeer,
    mediaId: string,
    requestOptions: MediaRequestOptions,
  ) =>
    new Promise<Blob | null>((resolve, reject) => {
      const { signal } = requestOptions;
      const req = nextReq;
      nextReq = nextReq >= 0xffffffff ? 1 : nextReq + 1;
      const onAbort = () => {
        if (finishIncoming(mediaPeer, req)) {
          sendControl(mediaPeer, { t: "cancel", req });
          transfer.reject(abortReason(signal as AbortSignal));
        }
      };
      const transfer: IncomingTransfer = {
        resolve(blob) {
          signal?.removeEventListener("abort", onAbort);
          resolve(blob);
        },
        reject(error) {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        onProgress: requestOptions.onProgress,
        chunks: [],
        received: 0,
        size: 0,
        type: "",
        hasMeta: false,
        stallTimer: 0,
      };
      mediaPeer.incoming.set(req, transfer);
      signal?.addEventListener("abort", onAbort);
      log("collaboration:media:request:start", {
        peerId: mediaPeer.peerId,
        mediaId,
      });
      armStallTimer(mediaPeer, req, transfer);
      if (!sendControl(mediaPeer, { t: "want", req, id: mediaId })) {
        finishIncoming(mediaPeer, req);
        transfer.reject(new Error("Media channel is not open."));
      }
    });

  const onPeers = () => syncPeers();
  provider.on("peers", onPeers);
  provider.on("status", onPeers);
  syncPeers();

  return {
    get mediaPeerCount() {
      let count = 0;
      for (const mediaPeer of peers.values()) {
        if (mediaPeer.ready) {
          count += 1;
        }
      }
      return count;
    },

    async requestMedia(mediaId, requestOptions = {}) {
      const { signal } = requestOptions;
      const tried = new Set<MediaPeer>();
      while (true) {
        if (destroyed) {
          throw new Error("Collaboration has been closed.");
        }
        if (signal?.aborted) {
          throw abortReason(signal);
        }
        syncPeers();
        const candidates = Array.from(peers.values()).filter(
          (mediaPeer) => !tried.has(mediaPeer),
        );
        // Prefer peers whose media channel is already open.
        const mediaPeer =
          candidates.find((candidate) => candidate.ready) ?? candidates[0];
        if (!mediaPeer) {
          return null;
        }
        tried.add(mediaPeer);
        try {
          await waitForReady(mediaPeer, signal);
          const blob = await requestFromPeer(
            mediaPeer,
            mediaId,
            requestOptions,
          );
          log("collaboration:media:request:end", {
            peerId: mediaPeer.peerId,
            mediaId,
            size: blob?.size ?? null,
          });
          if (blob) {
            return blob;
          }
        } catch (error) {
          if (signal?.aborted) {
            throw abortReason(signal);
          }
          if (destroyed) {
            throw error;
          }
        }
      }
    },

    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      provider.off("peers", onPeers);
      provider.off("status", onPeers);
      const reason = new Error("Collaboration has been closed.");
      for (const mediaPeer of Array.from(peers.values())) {
        closePeer(mediaPeer, reason);
      }
    },
  };
}
