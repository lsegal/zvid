import { invoke, isTauri } from "@tauri-apps/api/core";
import { save as nativeSave } from "@tauri-apps/plugin-dialog";
import { DEFAULT_TIME_SIGNATURE } from "./audio-mix/processor";
import type { AudioMix } from "./audio-mix/resolve";
import { exportExtension } from "./export-options";
import { gainToAmplitude } from "./fx/effects/gain/gain";
import { gainStageAt } from "./fx/effects/gain/processor";
import type { SaveTarget } from "./harness/contracts";
import { exportVideo } from "./harness/export";
import type { MediaItem } from "./media";
import {
  AUDIO_BITRATES,
  AUDIO_SAMPLE_RATES,
  DEFAULT_SESSION_ENCODING,
  exportContainer,
  type SessionSettings,
  VIDEO_CODECS,
} from "./session-settings";

const canvas = document.createElement("canvas");
canvas.width = 320;
canvas.height = 180;
function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing smoke test element: ${selector}`);
  return element;
}

const status = required<HTMLElement>("#status");
const native = isTauri();
const automationOutputDir = native
  ? new URLSearchParams(location.search).get("automationOutputDir")
  : null;

// The Session Settings to export with. Query parameters override the
// encoding defaults: codec (auto, h264, hevc, av1, or vp8 or vp9 for WebM),
// mbps (a custom video bitrate), audioKbps and sampleRate.
function smokeSettings(): SessionSettings {
  const query = new URLSearchParams(location.search);
  const encoding = { ...DEFAULT_SESSION_ENCODING };
  const codec = VIDEO_CODECS.find(({ value }) => value === query.get("codec"));
  if (codec) encoding.videoCodec = codec.value;
  const mbps = Number(query.get("mbps"));
  if (mbps > 0) {
    encoding.quality = "custom";
    encoding.customBitrateMbps = mbps;
  }
  const audioKbps = AUDIO_BITRATES.find(
    (value) => value === Number(query.get("audioKbps")),
  );
  if (audioKbps) encoding.audioBitrateKbps = audioKbps;
  const sampleRate = AUDIO_SAMPLE_RATES.find(
    (value) => value === Number(query.get("sampleRate")),
  );
  if (sampleRate) encoding.audioSampleRate = sampleRate;
  return { canvasWidth: 320, canvasHeight: 180, fps: 24, encoding };
}

async function reportAutomationError(error: unknown) {
  if (!automationOutputDir) return;
  await invoke("write_file_bytes", {
    path: `${automationOutputDir}/smoke-error.txt`,
    bytes: Array.from(new TextEncoder().encode(String(error))),
  });
}

function tone() {
  const sampleRate = 48_000;
  const frames = sampleRate * 2;
  const wav = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(wav);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, wav.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let index = 0; index < frames; index++)
    view.setInt16(
      44 + index * 2,
      Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 12_000),
      true,
    );
  return URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
}

async function destination(filename: string): Promise<SaveTarget | null> {
  if (!native) return { kind: "download", filename };
  if (automationOutputDir)
    return {
      kind: "native-path",
      filename,
      path: `${automationOutputDir}/${filename}`,
    };
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const path = await nativeSave({
    defaultPath: filename,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  return path ? { kind: "native-path", filename, path } : null;
}

async function write(blob: Blob, target: SaveTarget) {
  if (target.kind === "native-path") {
    await invoke("write_file_bytes", {
      path: target.path,
      bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
    });
    return "native-path" as const;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = target.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return "download" as const;
}

// The tone on two clips of a mix, each at −6 dB, so the export's audio is
// their sum: about the tone's own level.
function toneMix(previewUrl: string) {
  const clip = (id: string) => ({
    id,
    mediaId: "tone",
    startSeconds: 0,
    durationSeconds: 2,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 2,
    effects: [],
    amplitude: gainToAmplitude(-6),
    hasGain: true,
    busId: "tone",
    stages: [gainStageAt(gainToAmplitude(-6))],
  });
  const mix: AudioMix = {
    clips: [clip("tone-a"), clip("tone-b")],
    buses: [{ id: "tone", stages: [] }],
    master: [],
    masterAmplitude: 1,
    fromSourceTracks: true,
    bpm: 120,
    signature: DEFAULT_TIME_SIGNATURE,
  };
  return {
    mix,
    mediaItems: [{ id: "tone", hasAudio: true, previewUrl } as MediaItem],
  };
}

async function run(audible: boolean) {
  const settings = smokeSettings();
  const extension = exportExtension(
    exportContainer(settings.encoding.videoCodec),
  );
  const filename = `smoke-${audible ? "audible" : "video-only"}${extension}`;
  const saveTarget = await destination(filename);
  if (!saveTarget) return;
  const toneUrl = audible ? tone() : null;
  status.textContent = `Exporting ${filename}...`;
  try {
    const result = await exportVideo(
      {
        filename,
        saveTarget,
        canvas,
        settings,
        durationSeconds: 2,
        frameCount: 48,
        bpm: 120,
        audio: toneUrl ? toneMix(toneUrl) : undefined,
        renderFrameAt: async (_quarters, seconds) => {
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas 2D context is unavailable.");
          context.fillStyle = "#245078";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "white";
          context.font = "24px sans-serif";
          context.fillText(`Frame ${Math.floor(seconds * 24)}`, 20, 90);
        },
        setPlayheadQ: () => {},
        onProgress: (update) => {
          status.textContent = update.detail;
        },
      },
      (blob, target) => write(blob, target),
    );
    status.textContent = `Saved ${filename}: ${result.bytes} bytes, ${result.summary}`;
  } catch (error) {
    status.textContent = `Error: ${error}`;
    await reportAutomationError(error);
  } finally {
    if (toneUrl) URL.revokeObjectURL(toneUrl);
  }
}

required<HTMLButtonElement>("#video").addEventListener("click", () => {
  void run(false);
});
required<HTMLButtonElement>("#audio").addEventListener("click", () => {
  void run(true);
});
if (native && automationOutputDir) {
  void run(false);
}
