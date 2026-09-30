import { formatAppVersion, formatBuildTitle } from "../../build-info.ts";
import type { StatusItemProvider } from "../registry.ts";

// The running build, when there is one to show.
export const versionStatusItem: StatusItemProvider = {
  id: "version",
  order: 10,
  items: ({ version }) =>
    version
      ? [
          {
            id: "version",
            label: "zvid",
            value: formatAppVersion(version.version, version.commit),
            title: formatBuildTitle(version),
          },
        ]
      : [],
};
