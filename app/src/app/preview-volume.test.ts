import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PREVIEW_VOLUME_STORAGE_KEY } from "./constants.ts";
import {
  changePreviewVolume,
  DEFAULT_PREVIEW_VOLUME,
  formatPreviewVolume,
  isPreviewSilent,
  readPreviewVolume,
  togglePreviewMuted,
  writePreviewVolume,
} from "./preview-volume.ts";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem(): string | null {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

describe("preview volume", () => {
  it("keeps the slider position through mute and unmute", () => {
    const muted = togglePreviewMuted({ volume: 0.4, muted: false });
    assert.deepEqual(muted, { volume: 0.4, muted: true });
    assert.equal(isPreviewSilent(muted), true);
    assert.deepEqual(togglePreviewMuted(muted), { volume: 0.4, muted: false });
  });

  it("shows zero volume as muted, and unmutes it to full volume", () => {
    const zero = changePreviewVolume(DEFAULT_PREVIEW_VOLUME, 0);
    assert.deepEqual(zero, { volume: 0, muted: false });
    assert.equal(isPreviewSilent(zero), true);
    assert.deepEqual(togglePreviewMuted(zero), { volume: 1, muted: false });
  });

  it("unmutes when the slider moves above zero", () => {
    const muted = { volume: 0.5, muted: true };
    assert.deepEqual(changePreviewVolume(muted, 0.7), {
      volume: 0.7,
      muted: false,
    });
    assert.deepEqual(changePreviewVolume(muted, 0), { volume: 0, muted: true });
    assert.equal(changePreviewVolume(muted, 3).volume, 1);
  });

  it("formats the volume as a percentage", () => {
    assert.equal(formatPreviewVolume(0.8), "80%");
    assert.equal(formatPreviewVolume(0.333), "33%");
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    assert.deepEqual(readPreviewVolume(storage), DEFAULT_PREVIEW_VOLUME);
    writePreviewVolume({ volume: 0.25, muted: true }, storage);
    assert.deepEqual(readPreviewVolume(storage), { volume: 0.25, muted: true });
  });

  it("falls back to full volume when storage is unusable", () => {
    assert.deepEqual(
      readPreviewVolume(throwingStorage),
      DEFAULT_PREVIEW_VOLUME,
    );
    assert.doesNotThrow(() =>
      writePreviewVolume({ volume: 0.5, muted: false }, throwingStorage),
    );
    assert.deepEqual(readPreviewVolume(undefined), DEFAULT_PREVIEW_VOLUME);

    const storage = memoryStorage();
    storage.setItem(PREVIEW_VOLUME_STORAGE_KEY, "{not json");
    assert.deepEqual(readPreviewVolume(storage), DEFAULT_PREVIEW_VOLUME);
    storage.setItem(PREVIEW_VOLUME_STORAGE_KEY, '{"volume":7}');
    assert.deepEqual(readPreviewVolume(storage), { volume: 1, muted: false });
  });
});
