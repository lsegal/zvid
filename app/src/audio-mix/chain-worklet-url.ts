// The bundled chain worklet's URL, for `audioWorklet.addModule`. Kept apart
// from the mixer so the unit tests, which run outside Vite, can import it.
import chainWorkletUrl from "./chain-worklet.ts?worker&url";

export const CHAIN_WORKLET_URL = chainWorkletUrl;
