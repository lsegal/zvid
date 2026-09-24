// Cheap content fingerprint for media blobs. Hashing every byte of a long
// recording would cost more than the cache saves, so this hashes the size,
// type, and a few fixed slices spread across the file. Replacing or relinking
// media with different content changes the fingerprint, which invalidates
// anything cached for the old content under the same media id.

const SAMPLE_BYTES = 64 * 1024;
const SAMPLE_COUNT = 4;

function sampleOffsets(size: number) {
  if (size <= SAMPLE_BYTES * SAMPLE_COUNT) {
    return [0];
  }

  const last = size - SAMPLE_BYTES;
  const offsets: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    offsets.push(Math.floor((last * index) / (SAMPLE_COUNT - 1)));
  }
  return offsets;
}

// 64-bit FNV-1a split into two 32-bit lanes; crypto.subtle is unavailable
// outside secure contexts, such as the dev server opened over a LAN address.
function hashBytes(state: [number, number], bytes: Uint8Array) {
  let [high, low] = state;
  for (const byte of bytes) {
    low = (low ^ byte) >>> 0;
    const lowProduct = low * 0x1b3;
    const carry = Math.floor(lowProduct / 0x100000000);
    high = (Math.imul(high, 0x1b3) + Math.imul(low, 0x100) + carry) >>> 0;
    low = lowProduct >>> 0;
  }
  state[0] = high;
  state[1] = low;
}

export async function fingerprintMediaBlob(blob: Blob) {
  const state: [number, number] = [0xcbf29ce4, 0x84222325];
  const encoder = new TextEncoder();
  hashBytes(state, encoder.encode(`${blob.size}:${blob.type}`));

  const sampleLength =
    blob.size <= SAMPLE_BYTES * SAMPLE_COUNT ? blob.size : SAMPLE_BYTES;
  for (const offset of sampleOffsets(blob.size)) {
    const slice = blob.slice(offset, offset + sampleLength);
    hashBytes(state, new Uint8Array(await slice.arrayBuffer()));
  }

  const hex = (value: number) => value.toString(16).padStart(8, "0");
  return `${blob.size}-${hex(state[0])}${hex(state[1])}`;
}
