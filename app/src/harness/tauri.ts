import { buildFallbackWaveform, type MediaItem } from "../media";
import type { ServerMediaRef, SessionOpenResponse } from "../session";
import type { Harness } from "./contracts";
import { exportVideo } from "./export";
import { generateThumbnailFromUrlAtTime } from "./web-media";

function basename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

function createMediaId(rawPath: string) {
  let hash = 0;
  for (let index = 0; index < rawPath.length; index += 1) {
    hash = (hash * 31 + rawPath.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(16)}-${basename(rawPath)}`;
}

type SessionOpenPayload = Omit<SessionOpenResponse, "mediaRefs"> & {
  mediaRefs: Array<Omit<ServerMediaRef, "url">>;
};

type NativeMediaAnalysis = {
  path: string;
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  thumbnailPath?: string;
};

export async function maybeCreateTauriHarness(
  base: Harness,
): Promise<Harness | null> {
  try {
    const [{ convertFileSrc, invoke, isTauri }, dialog] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/plugin-dialog"),
    ]);

    if (!isTauri()) {
      return null;
    }

    const { open, save } = dialog;

    return {
      ...base,
      id: "tauri",
      label: "Tauri",
      capabilities: {
        ...base.capabilities,
        "native-dialogs": true,
        "session-paths": true,
        "asset-urls": true,
        "native-blob-write": true,
      },
      async pickSession() {
        const selected = await open({
          multiple: false,
          directory: false,
          filters: [
            {
              name: "Zvid Session",
              extensions: ["lvp", "json"],
            },
          ],
        });
        if (!selected || Array.isArray(selected)) {
          return null;
        }

        return {
          kind: "path" as const,
          path: selected,
          name: basename(selected),
        };
      },
      async pickMedia() {
        const selected = await open({
          multiple: true,
          directory: false,
          filters: [
            {
              name: "Media",
              extensions: [
                "mp4",
                "mov",
                "mkv",
                "webm",
                "avi",
                "wav",
                "mp3",
                "m4a",
                "flac",
                "aif",
                "aiff",
              ],
            },
          ],
        });
        if (!selected) {
          return null;
        }

        const paths = Array.isArray(selected) ? selected : [selected];
        return {
          kind: "refs" as const,
          refs: paths.map<ServerMediaRef>((path) => ({
            id: createMediaId(path),
            path,
            name: basename(path),
            url: convertFileSrc(path),
            exists: true,
          })),
        };
      },
      async prepareSave(filename, options) {
        const selected = await save({
          defaultPath: filename,
          filters: options?.extensions?.length
            ? [
                {
                  name: options.description ?? "Media export",
                  extensions: options.extensions.map((value) =>
                    value.replace(/^\./, ""),
                  ),
                },
              ]
            : undefined,
        });
        if (!selected) {
          return null;
        }

        return {
          kind: "native-path" as const,
          filename,
          path: selected,
        };
      },
      openSession(selection) {
        if (selection.kind !== "path") {
          return base.openSession(selection);
        }

        return invoke<SessionOpenPayload>("open_session", {
          sessionPath: selection.path,
        }).then((payload) => ({
          ...payload,
          mediaRefs: payload.mediaRefs.map((ref) => ({
            ...ref,
            url: ref.exists ? convertFileSrc(ref.path) : "",
          })),
        }));
      },
      async analyzeMedia(selection, palettes, startIndex) {
        if (selection.kind === "files") {
          return base.analyzeMedia(selection, palettes, startIndex);
        }

        const analyses = await invoke<NativeMediaAnalysis[]>("analyze_media", {
          paths: selection.refs.map((ref) => ref.path),
        });
        const analysisByPath = new Map(
          analyses.map((analysis) => [analysis.path, analysis]),
        );

        return selection.refs.map<MediaItem>((ref, index) => {
          const palette =
            palettes[(startIndex + index) % palettes.length] ?? palettes[0];
          const analysis = analysisByPath.get(ref.path);
          const hasVideo = Boolean(analysis?.hasVideo);
          return {
            id: ref.id,
            name: ref.name,
            kind: hasVideo ? "video" : "audio",
            durationSeconds: analysis?.durationSeconds ?? 0,
            width: analysis?.width,
            height: analysis?.height,
            fps: analysis?.fps,
            sampleRate: analysis?.sampleRate,
            channels: analysis?.channels,
            hasAudio: Boolean(analysis?.hasAudio),
            hasVideo,
            color: palette.color,
            accent: palette.accent,
            waveform: buildFallbackWaveform(ref.name),
            previewUrl: ref.url,
            thumbnailUrl: analysis?.thumbnailPath
              ? convertFileSrc(analysis.thumbnailPath)
              : undefined,
            sourcePath: ref.path,
            availability: ref.exists ? "ready" : "offline",
          };
        });
      },
      async readMediaBlob(target) {
        if (target.sourcePath) {
          const bytes = await invoke<number[]>("read_file_bytes", {
            path: target.sourcePath,
          });
          return new Blob([new Uint8Array(bytes)]);
        }

        return base.readMediaBlob(target);
      },
      async generateThumbnailAtTime(media, timeSeconds) {
        if (!media.hasVideo) {
          return undefined;
        }

        if (media.sourcePath) {
          const thumbnailPath = await invoke<string | null>(
            "generate_thumbnail_at_time",
            {
              path: media.sourcePath,
              timeSeconds,
            },
          );
          return thumbnailPath ? convertFileSrc(thumbnailPath) : undefined;
        }

        return generateThumbnailFromUrlAtTime(media.previewUrl, timeSeconds);
      },
      async saveBlob(blob, target) {
        if (target.kind !== "native-path") {
          return base.saveBlob(blob, target);
        }

        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await invoke("write_file_bytes", {
          path: target.path,
          bytes,
        });
        return "native-path" as const;
      },
      async exportVideo(request) {
        return exportVideo(
          request,
          async (blob, target) => {
            if (target.kind !== "native-path")
              return base.saveBlob(blob, target);
            await invoke("write_file_bytes", {
              path: target.path,
              bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
            });
            return "native-path";
          },
          async (video, audio) => {
            const pcm = audio
              ? Array.from({ length: audio.numberOfChannels }, (_, channel) =>
                  Array.from(audio.getChannelData(channel)),
                )
              : null;
            return new Uint8Array(
              await invoke<number[]>("mux_export", {
                video: Array.from(video),
                pcm,
                sampleRate: audio?.sampleRate ?? 48000,
              }),
            );
          },
        );
      },
    };
  } catch {
    return null;
  }
}
