import {
  alsMediaCandidatePaths,
  alsMediaSearchDirs,
  alsRecordDirLocator,
  alsSavePath,
  createAlsMediaLocator,
  importAls,
  isAlsSession,
  probeAlsRecordings,
  resolveAlsMedia,
} from "../als-import";
import { siblingAudioFilename } from "../import/als/convert";
import {
  collectSessionMediaPaths,
  type ServerMediaRef,
  type SessionOpenResponse,
} from "../session";
import type { Harness } from "./contracts";
import { exportVideo } from "./export";
import { MEDIA_EXTENSIONS } from "./media-extensions";
import {
  generateThumbnailFromUrlAtTime,
  probeRecordingFrames,
} from "./web-media";

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
    const [{ convertFileSrc, invoke, isTauri }, { documentDir }, dialog] =
      await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/path"),
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

    // Imports a Live set with its sibling `.wav` mixdown, if any, and locates
    // its recordings in their ZVID Capture record folder, beside the set, in
    // the project's sibling `Recorded` folder, then in Documents/Layers/Recorded.
    const openAlsSession = async (
      bytes: Uint8Array,
      sessionPath: string,
    ): Promise<SessionOpenResponse> => {
      const audioPath = siblingAudioFilename(sessionPath);
      const [audioExists] = await invoke<boolean[]>("files_exist", {
        paths: [audioPath],
      });
      const audioFilename = audioExists ? audioPath : undefined;
      const imported = await importAls(bytes, sessionPath, { audioFilename });
      const documentsDir = await documentDir().catch(() => undefined);
      const dirs = alsMediaSearchDirs(sessionPath, documentsDir);
      const recordDirOf = alsRecordDirLocator(
        imported,
        sessionPath,
        documentsDir,
      );
      const candidates = alsMediaCandidatePaths(imported, dirs, recordDirOf);
      const exists = await invoke<boolean[]>("files_exist", {
        paths: candidates,
      });
      const found = new Set(candidates.filter((_, index) => exists[index]));
      if (audioFilename) {
        found.add(audioFilename);
      }
      const { session, recordingPaths, summary } = resolveAlsMedia(
        imported,
        createAlsMediaLocator(dirs, (path) => found.has(path), recordDirOf),
      );
      const probed = await probeAlsRecordings(
        session,
        recordingPaths.map(toMediaRef),
        probeRecordingFrames,
      );
      return {
        sessionName: basename(sessionPath),
        sessionPath: alsSavePath(sessionPath),
        session: probed,
        mediaRefs: collectSessionMediaPaths(probed).map((path) =>
          found.has(path)
            ? toMediaRef(path)
            : { ...toMediaRef(path), url: "", exists: false },
        ),
        alsImport: summary,
      };
    };

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
              name: "Session or Ableton Live Set",
              extensions: ["lvp", "als", "json"],
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
      async openSession(selection) {
        if (selection.kind !== "path") {
          return base.openSession(selection);
        }

        const prefix = new Uint8Array(
          await invoke<number[]>("read_file_prefix", {
            path: selection.path,
            length: 2,
          }),
        );
        if (isAlsSession(prefix, selection.path)) {
          const bytes = await invoke<number[]>("read_file_bytes", {
            path: selection.path,
          });
          return openAlsSession(new Uint8Array(bytes), selection.path);
        }

        const payload = await invoke<SessionOpenPayload>("open_session", {
          sessionPath: selection.path,
        });
        return {
          ...payload,
          mediaRefs: payload.mediaRefs.map((ref) => ({
            ...ref,
            url: ref.exists ? convertFileSrc(ref.path) : "",
          })),
        };
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
      async generateThumbnailAtTime(media, timeSeconds, size) {
        if (!media.hasVideo) {
          return undefined;
        }

        return generateThumbnailFromUrlAtTime(
          media.previewUrl,
          timeSeconds,
          size,
        );
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
