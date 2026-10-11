import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { packageName, prebundledDependencies } from "./prebundle.ts";

const MANIFEST = {
  dependencies: {
    "@fontsource/anton": "^5.3.0",
    "@heroicons/react": "^2.2.0",
    "@radix-ui/react-select": "^2.3.7",
    "@zvid/tokens": "link:../packages/tokens",
    mediabunny: "^1.40.1",
    react: "^19.2.4",
  },
  devDependencies: {
    "@vitest/browser-playwright": "^5.0.3",
    vitest: "^5.0.3",
    "vitest-browser-react": "^2.3.0",
  },
};

describe("packageName", () => {
  it("keeps the scope of a scoped package", () => {
    assert.equal(packageName("@heroicons/react/24/solid"), "@heroicons/react");
    assert.equal(packageName("react-dom/client"), "react-dom");
    assert.equal(packageName("react"), "react");
  });
});

describe("prebundledDependencies", () => {
  it("lists static, side-effect and dynamic imports of manifest packages", () => {
    const sources = [
      'import { useRef } from "react";\nimport * as Select from "@radix-ui/react-select";',
      'import { PlayIcon } from "@heroicons/react/24/solid";',
      'import "react";\nconst load = () => import("mediabunny");',
      'import { render } from "vitest-browser-react";',
    ];
    assert.deepEqual(prebundledDependencies(sources, MANIFEST), [
      "@heroicons/react/24/solid",
      "@radix-ui/react-select",
      "mediabunny",
      "react",
      "vitest-browser-react",
    ]);
  });

  it("skips node builtins, relative paths, stylesheets, linked and unknown packages", () => {
    const sources = [
      'import { readFileSync } from "node:fs";',
      'import { clip } from "../clip.ts";',
      'import "@fontsource/anton/400.css";',
      'import tokens from "@zvid/tokens";',
      'import { unknown } from "left-pad";',
      'const message = "not a tar";',
    ];
    assert.deepEqual(prebundledDependencies(sources, MANIFEST), []);
  });

  it("leaves Vitest's own packages to Vitest", () => {
    const sources = [
      'import { expect } from "vitest";\nimport { page } from "vitest/browser";',
      'import { playwright } from "@vitest/browser-playwright";',
    ];
    assert.deepEqual(prebundledDependencies(sources, MANIFEST), []);
  });
});
