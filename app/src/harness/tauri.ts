import type { ServerMediaRef, SessionOpenResponse } from "../session";
import type { Harness } from "./contracts";
import { exportVideo } from "./export";
import { MEDIA_EXTENSIONS } from "./media-extensions";
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

    const toMediaRef = (path: string): ServerMediaRef => ({
      id: createMediaId(path),
      path,
      name: basename(path),
      url: convertFileSrc(path),
      exists: true,
    });

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
      async pickMedia(options) {
        const selected = await open({
          multiple: options?.multiple ?? true,
          directory: false,
          filters: [
            {
              name: "Media",
              extensions: MEDIA_EXTENSIONS,
            },
          ],
        });
        if (!selected) {
          return null;
        }

        const paths = Array.isArray(selected) ? selected : [selected];
        return {
          kind: "refs" as const,
          refs: paths.map(toMediaRef),
        };
      },
      async pickMediaFolder() {
        const selected = await open({ multiple: false, directory: true });
        if (!selected || Array.isArray(selected)) {
          return null;
        }

        const paths = await invoke<string[]>("list_media_files", {
          root: selected,
          extensions: MEDIA_EXTENSIONS,
        });
        return { kind: "refs" as const, refs: paths.map(toMediaRef) };
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
        const analyzed = await base.analyzeMedia(
          selection,
          palettes,
          startIndex,
        );
        return analyzed.map((item, index) => ({
          ...item,
          availability: selection.refs[index].exists
            ? ("ready" as const)
            : ("offline" as const),
        }));
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
