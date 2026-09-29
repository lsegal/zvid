import {
  alsMainAudioPath,
  alsSavePath,
  importAls,
  isAlsSession,
  probeAlsRecordings,
  rankWorkspaceSessions,
  resolveAlsMedia,
} from "../als-import";
import {
  collectSessionMediaPaths,
  type LvpSession,
  type ServerMediaRef,
  type SessionOpenResponse,
} from "../session";
import type {
  Harness,
  MediaSelection,
  SaveFilePickerHandle,
  SaveOptions,
  SaveTarget,
  SessionSelection,
  WorkspaceFileRef,
} from "./contracts";
import { exportVideo } from "./export";
import { hasMediaExtension, MEDIA_EXTENSIONS } from "./media-extensions";
import {
  analyzeMediaSelection,
  generateThumbnailFromUrlAtTime,
  probeRecordingFrames,
} from "./web-media";

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFilePickerHandle>;
};

type DirectoryInput = HTMLInputElement & {
  webkitdirectory: boolean;
  directory: boolean;
};

function buildPickerAccept(options?: SaveOptions) {
  const extensions = options?.extensions?.length
    ? options.extensions
    : [".mp4"];
  const mimeType = options?.mimeType ?? "video/mp4";
  return {
    [mimeType]: extensions,
  };
}

function pickFiles(options: { accept: string; multiple: boolean }) {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = options.accept;
    input.multiple = options.multiple;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.addEventListener(
      "change",
      () => {
        resolve(Array.from(input.files ?? []));
        input.remove();
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

function pickDirectoryFiles() {
  return new Promise<WorkspaceFileRef[] | null>((resolve) => {
    const input = document.createElement("input") as DirectoryInput;
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.directory = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();

        if (!files.length) {
          resolve(null);
          return;
        }

        resolve(
          files.map((file) => ({
            path:
              file.webkitRelativePath.split("/").slice(1).join("/") ||
              file.name,
            file,
          })),
        );
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

async function pickMediaFolder(): Promise<MediaSelection | null> {
  const entries = await pickDirectoryFiles();
  if (!entries) {
    return null;
  }

  const files = entries
    .map(({ file }) => file)
    .filter(
      (file) =>
        file.type.startsWith("video/") ||
        file.type.startsWith("audio/") ||
        hasMediaExtension(file.name),
    );
  return { kind: "files", files };
}

function basename(rawPath: string) {
  return rawPath.split(/[/\\]/).filter(Boolean).pop() ?? rawPath;
}

function normalizeWorkspacePath(rawPath: string) {
  return rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^[a-z]:\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function createPathId(rawPath: string) {
  let hash = 0;
  for (let index = 0; index < rawPath.length; index += 1) {
    hash = (hash * 31 + rawPath.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(16)}-${basename(rawPath)}`;
}

async function pickWorkspaceSession(): Promise<SessionSelection | null> {
  const files = await pickDirectoryFiles();
  if (!files) {
    return null;
  }

  const firstRelativePath = files[0]?.file.webkitRelativePath;
  const rootName = firstRelativePath?.split("/")[0] || "Workspace";
  const sessionEntry = chooseWorkspaceSession(files);
  if (!sessionEntry) {
    return null;
  }

  return {
    kind: "workspace",
    rootName,
    sessionPath: sessionEntry.path,
    sessionFile: sessionEntry.file,
    files,
  };
}

function chooseWorkspaceSession(files: WorkspaceFileRef[]) {
  const sessionCandidates = rankWorkspaceSessions(files);

  if (!sessionCandidates.length) {
    throw new Error(
      "No .lvp session or Ableton .als set was found in the selected workspace.",
    );
  }

  if (sessionCandidates.length === 1) {
    return sessionCandidates[0];
  }

  const choices = sessionCandidates
    .slice(0, 20)
    .map((entry, index) => `${index + 1}. ${entry.path}`)
    .join("\n");
  const rawChoice = window.prompt(
    `Choose a session file to open:\n${choices}`,
    "1",
  );
  if (!rawChoice) {
    return null;
  }

  const index = Number.parseInt(rawChoice, 10) - 1;
  return sessionCandidates[index] ?? null;
}

function createWorkspaceResolver(rootName: string, files: WorkspaceFileRef[]) {
  const byPath = new Map<string, WorkspaceFileRef>();
  const byBasename = new Map<string, WorkspaceFileRef | null>();

  for (const entry of files) {
    byPath.set(normalizeWorkspacePath(entry.path), entry);
    const name = basename(entry.path).toLowerCase();
    byBasename.set(name, byBasename.has(name) ? null : entry);
  }

  return (rawPath: string) => {
    const normalized = normalizeWorkspacePath(rawPath);
    const rootIndex = normalized.lastIndexOf(`/${rootName.toLowerCase()}/`);
    const rootedPath =
      rootIndex >= 0
        ? normalized.slice(rootIndex + rootName.length + 2)
        : normalized;

    return (
      byPath.get(normalized) ??
      byPath.get(rootedPath) ??
      byBasename.get(basename(rawPath).toLowerCase()) ??
      null
    );
  };
}

function workspaceDir(rawPath: string) {
  const segments = normalizeWorkspacePath(rawPath).split("/");
  return segments.slice(0, -1);
}

// Finds a Live set's recording in the workspace: in the set's ZVID Capture
// `Recorded/ZVID` folder, beside the set, in the `Recorded` folder beside its
// project, then anywhere by name.
function createWorkspaceAlsLocator(
  selection: Extract<SessionSelection, { kind: "workspace" }>,
) {
  const byPath = new Map(
    selection.files.map((entry) => [normalizeWorkspacePath(entry.path), entry]),
  );
  const resolveFile = createWorkspaceResolver(
    selection.rootName,
    selection.files,
  );
  const setDir = workspaceDir(selection.sessionPath);
  const recordedDir = [...setDir.slice(0, -1), "recorded"];
  const zvidRecordedDir = [...setDir, "recorded", "zvid"];

  return (name: string) => {
    const filename = basename(name).toLowerCase();
    const entry =
      byPath.get([...zvidRecordedDir, filename].join("/")) ??
      byPath.get([...setDir, filename].join("/")) ??
      byPath.get([...recordedDir, filename].join("/")) ??
      resolveFile(filename);
    return entry?.path ?? null;
  };
}

async function openWorkspaceAls(
  bytes: Uint8Array,
  selection: Extract<SessionSelection, { kind: "workspace" }>,
): Promise<SessionOpenResponse> {
  const workspacePaths = new Set(
    selection.files.map((entry) => normalizeWorkspacePath(entry.path)),
  );
  const audioFilename = alsMainAudioPath(selection.sessionPath, (path) =>
    workspacePaths.has(normalizeWorkspacePath(path)),
  );
  const imported = await importAls(bytes, selection.sessionFile.name, {
    audioFilename,
  });
  const { session, recordingPaths, layersRecordTracks, summary } =
    resolveAlsMedia(imported, createWorkspaceAlsLocator(selection));
  const byPath = new Map(
    selection.files.map((entry) => [entry.path, entry.file]),
  );
  const recordingRefs = recordingPaths.flatMap<ServerMediaRef>((path) => {
    const file = byPath.get(path);
    return file
      ? [
          {
            id: createPathId(path),
            path,
            name: basename(path),
            url: URL.createObjectURL(file),
            exists: true,
          },
        ]
      : [];
  });
  try {
    const probed = await probeAlsRecordings(
      session,
      recordingRefs,
      probeRecordingFrames,
      layersRecordTracks,
    );
    return {
      ...buildWorkspaceOpenPayload(probed, selection),
      sessionPath: alsSavePath(
        `${selection.rootName}/${selection.sessionPath}`,
      ),
      alsImport: summary,
    };
  } finally {
    for (const ref of recordingRefs) {
      URL.revokeObjectURL(ref.url);
    }
  }
}

// Fills an imported Live set's recording metadata from the refs the server
// located, then drops those refs so only the session's media is hydrated.
async function finishAlsOpen(
  payload: SessionOpenResponse,
): Promise<SessionOpenResponse> {
  const { recordingRefs, ...rest } = payload;
  if (!recordingRefs?.length) {
    return rest;
  }

  return {
    ...rest,
    session: await probeAlsRecordings(
      rest.session,
      recordingRefs,
      probeRecordingFrames,
    ),
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function postSessionOpen(
  endpoint: string,
  body: Record<string, string>,
): Promise<SessionOpenResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as
    | SessionOpenResponse
    | { error: string };
  if (!response.ok || "error" in payload) {
    throw new Error(
      "error" in payload
        ? payload.error
        : `Request failed with ${response.status}`,
    );
  }

  return finishAlsOpen(payload);
}

function buildWorkspaceOpenPayload(
  session: LvpSession,
  selection: Extract<SessionSelection, { kind: "workspace" }>,
): SessionOpenResponse {
  const resolveFile = createWorkspaceResolver(
    selection.rootName,
    selection.files,
  );
  const mediaRefs = collectSessionMediaPaths(session).map<ServerMediaRef>(
    (rawPath) => {
      const entry = resolveFile(rawPath);
      return {
        id: createPathId(rawPath),
        path: rawPath,
        name: basename(rawPath),
        url: entry ? URL.createObjectURL(entry.file) : "",
        exists: Boolean(entry),
      };
    },
  );

  return {
    session,
    sessionName: selection.sessionFile.name,
    sessionPath: `${selection.rootName}/${selection.sessionPath}`,
    mediaRefs,
  };
}

function buildFileOpenPayload(
  session: LvpSession,
  sessionName: string,
): SessionOpenResponse {
  // A lone session file carries no media, so every reference opens as missing.
  const mediaRefs = collectSessionMediaPaths(session).map<ServerMediaRef>(
    (rawPath) => ({
      id: createPathId(rawPath),
      path: rawPath,
      name: basename(rawPath),
      url: "",
      exists: false,
    }),
  );

  return { session, sessionName, mediaRefs };
}

async function prepareSave(
  filename: string,
  options?: SaveOptions,
): Promise<SaveTarget> {
  const pickerWindow = window as SaveFilePickerWindow;
  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: options?.description ?? "Media export",
          accept: buildPickerAccept(options),
        },
      ],
    });
    return {
      kind: "picker",
      filename,
      handle,
    };
  }

  return {
    kind: "download",
    filename,
  };
}

async function saveBlob(blob: Blob, target: SaveTarget) {
  if (target.kind === "picker") {
    const writable = await target.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "picker" as const;
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = target.filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  return "download" as const;
}

async function readMediaBlob(target: { name: string; previewUrl: string }) {
  if (!target.previewUrl) {
    throw new Error(
      `No browser-readable media URL is available for ${target.name}.`,
    );
  }

  const response = await fetch(target.previewUrl);
  if (!response.ok) {
    throw new Error(`Failed to read ${target.name}: ${response.status}`);
  }

  return response.blob();
}

export function createWebHarness(): Harness {
  return {
    id: "web",
    label: "Web",
    capabilities: {
      "browser-dialogs": true,
    },
    async pickSession(): Promise<SessionSelection | null> {
      const files = await pickFiles({
        accept: ".lvp,.als,application/json",
        multiple: false,
      });
      const file = files[0];
      if (!file) {
        return null;
      }

      return { kind: "file", file };
    },
    pickWorkspace: pickWorkspaceSession,
    async pickMedia(options) {
      const files = await pickFiles({
        accept: [
          "video/*",
          "audio/*",
          ...MEDIA_EXTENSIONS.map((ext) => `.${ext}`),
        ].join(","),
        multiple: options?.multiple ?? true,
      });
      return files.length ? { kind: "files", files } : null;
    },
    pickMediaFolder,
    async openSession(selection): Promise<SessionOpenResponse> {
      if (selection.kind === "workspace") {
        const bytes = new Uint8Array(await selection.sessionFile.arrayBuffer());
        if (isAlsSession(bytes, selection.sessionFile.name)) {
          return openWorkspaceAls(bytes, selection);
        }

        const session = JSON.parse(
          new TextDecoder().decode(bytes),
        ) as LvpSession;
        return buildWorkspaceOpenPayload(session, selection);
      }

      if (selection.kind === "path") {
        return postSessionOpen("/api/session/open", {
          sessionPath: selection.path,
        });
      }

      const bytes = new Uint8Array(await selection.file.arrayBuffer());
      const isAls = isAlsSession(bytes, selection.file.name);

      // The deployed Worker has no session endpoints, so only the dev server
      // can resolve the session's on-disk media paths.
      if (!import.meta.env.DEV) {
        if (isAls) {
          const imported = await importAls(bytes, selection.file.name);
          const { session, summary } = resolveAlsMedia(imported, () => null);
          return {
            ...buildFileOpenPayload(session, selection.file.name),
            alsImport: summary,
          };
        }

        const session = JSON.parse(
          new TextDecoder().decode(bytes),
        ) as LvpSession;
        return buildFileOpenPayload(session, selection.file.name);
      }

      return postSessionOpen(
        "/api/session/open-file",
        isAls
          ? {
              sessionName: selection.file.name,
              sessionBase64: bytesToBase64(bytes),
            }
          : {
              sessionName: selection.file.name,
              sessionContents: new TextDecoder().decode(bytes),
            },
      );
    },
    analyzeMedia: analyzeMediaSelection,
    readMediaBlob,
    generateThumbnailAtTime(media, timeSeconds, size) {
      if (!media.hasVideo) {
        return Promise.resolve(undefined);
      }

      return generateThumbnailFromUrlAtTime(
        media.previewUrl,
        timeSeconds,
        size,
      );
    },
    prepareSave,
    saveBlob,
    exportVideo(request) {
      return exportVideo(request, saveBlob);
    },
  };
}
