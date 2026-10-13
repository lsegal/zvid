// Importing media into source tracks, and exporting the session.
import { normalizeExportFileName } from "../../export-options.ts";
import { exportContainer, sessionSettingsFromProject } from "../../session-settings.ts";
import {
  BEATS_NOTE,
  describeSourceClip,
  optionalNumber,
  optionalString,
  requireString,
  round,
} from "../helpers.ts";
import { objectSchema } from "../schema.ts";
import {
  type ControlCommand,
  type ControlExportRequest,
  ControlFailure,
} from "../types.ts";

// The file name a URL names, such as "clip.mp4" for ".../clip.mp4?x=1".
export function fileNameFromUrl(url: string) {
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return undefined;
  }
  try {
    const name = new URL(url).pathname.split("/").pop();
    return name ? decodeURIComponent(name) : undefined;
  } catch {
    return undefined;
  }
}

export const mediaCommands: ControlCommand[] = [
  {
    name: "import_media",
    description: `Imports a video, audio or image file from a URL (http(s), data: or blob:) into a source track: a new one, or sourceTrackId's. Source tracks hold the session's media; add_clip with kind "media" and a returned sourceClipId puts it on a layer. Images and LUTs go to the media library only, for effects to use. ${BEATS_NOTE}`,
    inputSchema: objectSchema(
      {
        url: {
          type: "string",
          description: "Where to fetch the file.",
          minLength: 1,
        },
        name: {
          type: "string",
          description:
            'The file name, with its extension, such as "drums.wav"; taken from the URL when omitted.',
          minLength: 1,
        },
        sourceTrackId: {
          type: "string",
          description: "Add it to this source track instead of a new one.",
        },
        startBeats: {
          type: "number",
          description:
            "Where it starts on the source track, in beats; after the track's last clip when omitted.",
          minimum: 0,
        },
      },
      ["url"],
    ),
    edits: true,
    async run(host, input) {
      const url = requireString(input, "url");
      const name = optionalString(input, "name") ?? fileNameFromUrl(url);
      if (!name) {
        throw new ControlFailure(
          "invalid_input",
          '"name" is required when the URL has no file name.',
        );
      }
      const sourceTrackId = optionalString(input, "sourceTrackId");
      if (
        sourceTrackId !== undefined &&
        !host.getProject().sourceTracks.some((track) => track.id === sourceTrackId)
      ) {
        throw new ControlFailure(
          "not_found",
          `No source track has id "${sourceTrackId}".`,
        );
      }
      let blob: Blob;
      try {
        const response = await host.fetch(url);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`.trim());
        }
        blob = await response.blob();
      } catch (error) {
        throw new ControlFailure(
          "failed",
          `Could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const file = new File([blob], name, { type: blob.type });
      const startQ = optionalNumber(input, "startBeats");
      const { imported, error } = await host.importMedia(
        [file],
        sourceTrackId === undefined
          ? { kind: "new-track", startQ }
          : { kind: "track", trackId: sourceTrackId, startQ },
      );
      if (!imported.length) {
        throw new ControlFailure("failed", error ?? "No media was imported.");
      }
      const project = host.getProject();
      const ids = new Set(imported.map((item) => item.id));
      const sourceClips = project.sourceSpans
        .filter((span) => span.mediaId !== undefined && ids.has(span.mediaId))
        .map((span) => describeSourceClip(span, project.bpm));
      return {
        media: imported.map((item) => ({
          id: item.id,
          name: item.name,
          kind: item.kind,
          durationSeconds: round(item.durationSeconds),
          hasVideo: item.hasVideo,
          hasAudio: item.hasAudio,
        })),
        sourceClips,
      };
    },
  },
  {
    name: "export_video",
    description: `Renders the session to a video file with its settings (see update_session) and waits until it is written. destination "memory" keeps the file and returns a blob: URL to fetch it from inside the page; "download" saves it through the browser's download flow; "path" writes it to an absolute file path, in the desktop app only. The range defaults to the whole arrangement. ${BEATS_NOTE}`,
    inputSchema: objectSchema({
      fileName: {
        type: "string",
        description: "The file name; the extension follows the codec.",
        minLength: 1,
      },
      destination: {
        type: "string",
        description: 'Where the file goes; "memory" when omitted.',
        enum: ["memory", "download", "path"],
      },
      path: {
        type: "string",
        description: 'For destination "path": the absolute file path.',
      },
      startBeats: {
        type: "number",
        description: "Where the export starts, in beats.",
        minimum: 0,
      },
      endBeats: {
        type: "number",
        description: "Where the export ends, in beats.",
        exclusiveMinimum: 0,
      },
    }),
    async run(host, input) {
      const project = host.getProject();
      const destination = (optionalString(input, "destination") ??
        "memory") as ControlExportRequest["destination"];
      const path = optionalString(input, "path");
      if (destination === "path" && !host.canExportToPath()) {
        throw new ControlFailure(
          "unavailable",
          'Only the desktop app can write to a path; use destination "memory" or "download".',
        );
      }
      if (destination === "path" && !path) {
        throw new ControlFailure(
          "invalid_input",
          '"path" is required for destination "path".',
        );
      }
      const startQ = optionalNumber(input, "startBeats");
      const endQ = optionalNumber(input, "endBeats");
      if ((startQ === undefined) !== (endQ === undefined)) {
        throw new ControlFailure(
          "invalid_input",
          'Pass both "startBeats" and "endBeats", or neither to export the whole arrangement.',
        );
      }
      if (startQ !== undefined && endQ !== undefined && endQ <= startQ) {
        throw new ControlFailure(
          "invalid_input",
          '"endBeats" must be after "startBeats".',
        );
      }
      const container = exportContainer(
        sessionSettingsFromProject(project).encoding.videoCodec,
      );
      const fileName = normalizeExportFileName(
        optionalString(input, "fileName") ??
          path?.split(/[\\/]/).pop() ??
          project.sessionName ??
          "zvid-export",
        container,
      );
      const outcome = await host.exportVideo({
        fileName,
        destination,
        ...(path ? { path } : {}),
        ...(startQ !== undefined && endQ !== undefined
          ? { range: { inQ: startQ, outQ: endQ } }
          : {}),
      });
      if (outcome.kind === "failed") {
        throw new ControlFailure("failed", outcome.message);
      }
      if (outcome.kind === "canceled") {
        throw new ControlFailure("failed", "The export was canceled.");
      }
      const { kind: _kind, ...result } = outcome;
      return result;
    },
  },
];
