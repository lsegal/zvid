import { formatAppVersion } from "./build-info";

// The running zvid version with the build's short SHA as semver build metadata,
// e.g. `0.0.0+c94f40e`, or the bare `0.0.0` when git was unavailable.
export const ZVID_VERSION = formatAppVersion(__APP_VERSION__, __APP_COMMIT__);
