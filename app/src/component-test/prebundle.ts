// The packages vitest.config.ts lists in `optimizeDeps.include`. Vite's
// dependency scan only follows the test files a run starts from, and it
// reuses a cached pre-bundle without rescanning. A run that then imports a
// package missing from that bundle re-optimizes and reloads the page
// mid-test, which can leave two copies of React. Deriving the list from the
// app's own imports keeps every package pre-bundled up front, including ones
// added later.

export type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./][^"']*)["']/g;

// Linked workspace packages are served as source, not pre-bundled.
const LINKED_VERSION = /^(link|workspace|file):/;

// Vitest pre-bundles its own entry points.
function isVitestPackage(name: string) {
  return name === "vitest" || name.startsWith("@vitest/");
}

export function packageName(specifier: string) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Returns the sorted bare import specifiers in `sources` that resolve to a
 * script in one of the manifest's packages. */
export function prebundledDependencies(
  sources: Iterable<string>,
  manifest: PackageManifest,
) {
  const versions = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
  const specifiers = new Set<string>();
  for (const source of sources) {
    for (const [, specifier] of source.matchAll(IMPORT_SPECIFIER)) {
      const name = packageName(specifier);
      const version = versions[name];
      if (
        version === undefined ||
        LINKED_VERSION.test(version) ||
        isVitestPackage(name) ||
        specifier.endsWith(".css")
      ) {
        continue;
      }
      specifiers.add(specifier);
    }
  }
  return [...specifiers].sort();
}
