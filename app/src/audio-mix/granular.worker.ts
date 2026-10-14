// Mixes a Granular clip's grains off the main thread, so long, dense
// clouds do not stall the editor while they render (see
// mixGrainsOffThread in granular.ts).
import { type Grain, mixGrains } from "./granular.ts";

export type GranularWorkerMessage = {
  grains: Grain[];
  sampleRate: number;
  length: number;
};

self.onmessage = (event: MessageEvent<GranularWorkerMessage>) => {
  const { grains, sampleRate, length } = event.data;
  const mixed = mixGrains(grains, sampleRate, length);
  self.postMessage(mixed, { transfer: [mixed.buffer] });
};
