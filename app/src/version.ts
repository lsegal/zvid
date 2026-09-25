import { type AppBuild, formatAppVersion } from "./build-info";

// The build this zvid was made from, as injected by vite.config.ts.
export const ZVID_BUILD: AppBuild = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  buildTime: __APP_BUILD_TIME__,
};

// The running zvid version with the build's short SHA as semver build metadata,
// e.g. `0.0.0+c94f40e`, or the bare `0.0.0` when git was unavailable.
export const ZVID_VERSION = formatAppVersion(
  ZVID_BUILD.version,
  ZVID_BUILD.commit,
);
