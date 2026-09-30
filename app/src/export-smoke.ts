import { invoke, isTauri } from "@tauri-apps/api/core";
import { save as nativeSave } from "@tauri-apps/plugin-dialog";
import type { SaveTarget } from "./harness/contracts";
import { exportVideo } from "./harness/export";
import type { MediaItem } from "./media";
import {
  AUDIO_BITRATES,
  AUDIO_SAMPLE_RATES,
  DEFAULT_SESSION_ENCODING,
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
let videoOnlyBytes: Uint8Array | null = null;
let videoOnlyCover: Uint8Array | undefined;

// The Session Settings to export with. Query parameters override the
// encoding defaults: codec (auto, h264, hevc, av1), mbps (a custom video
// bitrate), audioKbps and sampleRate.
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
  const path = await nativeSave({
    defaultPath: filename,
    filters: [{ name: "MP4", extensions: ["mp4"] }],
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

async function run(audible: boolean) {
  const filename = audible ? "smoke-audible.mp4" : "smoke-video-only.mp4";
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
        settings: smokeSettings(),
        durationSeconds: 2,
        frameCount: 48,
        bpm: 120,
        mainAudio: toneUrl
          ? ({ hasAudio: true, previewUrl: toneUrl } as MediaItem)
          : undefined,
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
      async (blob, target) => {
        if (!audible) videoOnlyBytes = new Uint8Array(await blob.arrayBuffer());
        return write(blob, target);
      },
      native
        ? async (video, audio, audioBitrate, cover) => {
            if (!audible) videoOnlyCover = cover;
            if (automationOutputDir)
              await invoke("write_file_bytes", {
                path: `${automationOutputDir}/encoder-video.mp4`,
                bytes: Array.from(video),
              });
            return new Uint8Array(
              await invoke<number[]>("mux_export", {
                video: Array.from(video),
                pcm: audio
                  ? Array.from(
                      { length: audio.numberOfChannels },
                      (_, channel) => Array.from(audio.getChannelData(channel)),
                    )
                  : null,
                sampleRate: audio?.sampleRate ?? 48_000,
                bitrate: audioBitrate,
                cover: cover ? Array.from(cover) : null,
              }),
            );
          }
        : undefined,
    );
    status.textContent = `Saved ${filename}: ${result.bytes} bytes, ${result.summary}`;
  } catch (error) {
    status.textContent = `Error: ${error}`;
    await reportAutomationError(error);
  } finally {
    if (toneUrl) URL.revokeObjectURL(toneUrl);
  }
}

async function testNativeAac() {
  if (!videoOnlyBytes) {
    status.textContent = "Export video only first.";
    return;
  }
  const filename = "smoke-native-aac.mp4";
  const saveTarget = await destination(filename);
  if (!saveTarget) return;
  status.textContent = "Encoding AAC through the native fallback...";
  try {
    const pcm = Array.from(
      { length: 96_000 },
      (_, index) => Math.sin((2 * Math.PI * 440 * index) / 48_000) * 0.36,
    );
    const bytes = await invoke<number[]>("mux_export", {
      video: Array.from(videoOnlyBytes),
      pcm: [pcm],
      sampleRate: 48_000,
      bitrate: 192_000,
      cover: videoOnlyCover ? Array.from(videoOnlyCover) : null,
    });
    await write(
      new Blob([new Uint8Array(bytes)], { type: "video/mp4" }),
      saveTarget,
    );
    status.textContent = `Saved ${filename}: ${bytes.length} bytes`;
  } catch (error) {
    status.textContent = `Error: ${error}`;
    await reportAutomationError(error);
  }
}

required<HTMLButtonElement>("#video").addEventListener("click", () => {
  void run(false);
});
required<HTMLButtonElement>("#audio").addEventListener("click", () => {
  void run(true);
});
if (native) {
  const nativeButton = required<HTMLButtonElement>("#native-aac");
  nativeButton.hidden = false;
  nativeButton.addEventListener("click", () => {
    void testNativeAac();
  });
  if (automationOutputDir) {
    void run(false).then(() => nativeButton.click());
  }
}
