import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { resolveAppCommit } from "./src/build-info.ts";

type LvpSession = {
  clips?: Array<{ filePath: string }>;
  audioFilename?: string;
};

type RegisteredMedia = {
  id: string;
  path: string;
  name: string;
  url: string;
  exists: boolean;
};

type SessionOpenPayload = {
  session: LvpSession;
  sessionName: string;
  mediaRefs: RegisteredMedia[];
  sessionPath?: string;
};

const mediaRegistry = new Map<string, RegisteredMedia>();

function createMediaId(filePath: string) {
  return createHash("sha1").update(filePath).digest("hex").slice(0, 16);
}

function getMimeType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    case ".aif":
    case ".aiff":
      return "audio/aiff";
    default:
      return "application/octet-stream";
  }
}

function normalizeMediaPath(filePath: string) {
  return path.normalize(filePath.trim());
}

function collectSessionMedia(session: LvpSession) {
  const mediaPaths = new Set<string>();

  for (const clip of session.clips ?? []) {
    if (clip.filePath?.trim()) {
      mediaPaths.add(normalizeMediaPath(clip.filePath));
    }
  }

  if (session.audioFilename?.trim()) {
    mediaPaths.add(normalizeMediaPath(session.audioFilename));
  }

  mediaRegistry.clear();
  console.info("[zvid] collectSessionMedia", {
    clips: session.clips?.length ?? 0,
    uniqueMediaPaths: mediaPaths.size,
    hasAudioFilename: Boolean(session.audioFilename?.trim()),
  });

  return Array.from(mediaPaths).map<RegisteredMedia>((filePath) => {
    const id = createMediaId(filePath);
    const entry = {
      id,
      path: filePath,
      name: path.basename(filePath),
      url: `/api/media/${id}`,
      exists: existsSync(filePath),
    };

    console.info("[zvid] registerMedia", {
      id,
      path: filePath,
      exists: entry.exists,
    });
    mediaRegistry.set(id, entry);
    return entry;
  });
}

function buildSessionOpenPayload(
  session: LvpSession,
  options: { sessionName: string; sessionPath?: string },
): SessionOpenPayload {
  return {
    session,
    sessionName: options.sessionName,
    sessionPath: options.sessionPath,
    mediaRefs: collectSessionMedia(session),
  };
}

function readJsonBody(request: NodeJS.ReadableStream) {
  return new Promise<unknown>((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function writeJson(
  response: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: string): void;
  },
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function diskMediaPlugin(): Plugin {
  return {
    name: "zvid-disk-media",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        const url = new URL(request.url, "http://localhost:1420");

        if (request.method === "POST" && url.pathname === "/api/session/open") {
          try {
            const body = (await readJsonBody(request)) as {
              sessionPath?: string;
            };
            const sessionPath = body.sessionPath?.trim();

            if (!sessionPath) {
              writeJson(response, 400, { error: "sessionPath is required" });
              return;
            }

            if (!existsSync(sessionPath)) {
              writeJson(response, 404, {
                error: `Session file not found: ${sessionPath}`,
              });
              return;
            }

            const raw = readFileSync(sessionPath, "utf8");
            const session = JSON.parse(raw) as LvpSession;
            writeJson(
              response,
              200,
              buildSessionOpenPayload(session, {
                sessionName: path.basename(sessionPath),
                sessionPath,
              }),
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            writeJson(response, 500, { error: message });
          }
          return;
        }

        if (
          request.method === "POST" &&
          url.pathname === "/api/session/open-file"
        ) {
          try {
            const body = (await readJsonBody(request)) as {
              sessionName?: string;
              sessionContents?: string;
            };
            const sessionContents = body.sessionContents?.trim();
            console.info("[zvid] /api/session/open-file", {
              sessionName: body.sessionName?.trim() || "Session.lvp",
              hasContents: Boolean(sessionContents),
              contentLength: sessionContents?.length ?? 0,
            });

            if (!sessionContents) {
              writeJson(response, 400, {
                error: "sessionContents is required",
              });
              return;
            }

            const session = JSON.parse(sessionContents) as LvpSession;
            writeJson(
              response,
              200,
              buildSessionOpenPayload(session, {
                sessionName: body.sessionName?.trim() || "Session.lvp",
              }),
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            writeJson(response, 500, { error: message });
          }
          return;
        }

        if (
          request.method === "GET" &&
          url.pathname.startsWith("/api/media/")
        ) {
          const id = url.pathname.slice("/api/media/".length);
          const entry = mediaRegistry.get(id);
          console.info("[zvid] /api/media request", {
            id,
            found: Boolean(entry),
          });

          if (!entry) {
            response.statusCode = 404;
            response.end("Unknown media id");
            return;
          }

          if (!existsSync(entry.path)) {
            response.statusCode = 404;
            response.end("Media file missing on disk");
            return;
          }

          const stats = statSync(entry.path);
          const fileSize = stats.size;
          const rangeHeader = request.headers.range;
          const mimeType = getMimeType(entry.path);

          response.setHeader("Accept-Ranges", "bytes");
          response.setHeader("Content-Type", mimeType);
          response.setHeader("Cache-Control", "no-store");

          if (!rangeHeader) {
            response.statusCode = 200;
            response.setHeader("Content-Length", fileSize.toString());
            createReadStream(entry.path).pipe(response);
            return;
          }

          const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
          if (!match) {
            response.statusCode = 416;
            response.end();
            return;
          }

          const start = match[1] ? Number.parseInt(match[1], 10) : 0;
          const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
          const safeStart = Math.max(0, Math.min(start, fileSize - 1));
          const safeEnd = Math.max(safeStart, Math.min(end, fileSize - 1));

          response.statusCode = 206;
          response.setHeader(
            "Content-Range",
            `bytes ${safeStart}-${safeEnd}/${fileSize}`,
          );
          response.setHeader(
            "Content-Length",
            (safeEnd - safeStart + 1).toString(),
          );
          createReadStream(entry.path, { start: safeStart, end: safeEnd }).pipe(
            response,
          );
          return;
        }

        next();
      });
    },
  };
}

const appCommit = resolveAppCommit(process.env, (args) =>
  execFileSync("git", args, {
    cwd: import.meta.dirname,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
const appBuildTime = new Date().toISOString();
// app/package.json is the source of truth for the zvid version; Tauri reads it
// directly and Cargo.toml is kept in step by a unit test.
const appVersion = (
  JSON.parse(
    readFileSync(path.join(import.meta.dirname, "package.json"), "utf8"),
  ) as { version: string }
).version;

// Publishes the build's version and commit at /version.json so `curl` can
// tell which build is deployed.
function versionFilePlugin(): Plugin {
  return {
    name: "zvid-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify(
          { version: appVersion, commit: appCommit, buildTime: appBuildTime },
          null,
          2,
        )}
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), diskMediaPlugin(), versionFilePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
    __APP_BUILD_TIME__: JSON.stringify(appBuildTime),
  },
  clearScreen: false,
  worker: {
    // The waveform peaks worker lazy-loads mediabunny, which needs chunking.
    format: "es",
  },
  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**", "**/export-bridge/target/**"],
    },
  },
});
