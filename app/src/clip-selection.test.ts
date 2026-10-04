import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The selected arrangement clip gets a neutral ring, a dark halo and a lift
// from CSS, never a ring in its own accent color: an amber clip's accent
// would otherwise look like the amber selection and playhead UI.
const clipCardTsx = readFileSync(
  new URL("./components/timeline/ClipCard.tsx", import.meta.url),
  "utf8",
);
const appCss = readFileSync(new URL("./App.css", import.meta.url), "utf8");
const clipCardCss = readFileSync(
  new URL("./components/timeline/clip-card.css", import.meta.url),
  "utf8",
);
const sourceSpanCss = readFileSync(
  new URL("./components/timeline/source-span.css", import.meta.url),
  "utf8",
);
const tokensCss = readFileSync(
  new URL("../../packages/tokens/tokens.css", import.meta.url),
  "utf8",
);

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

function zToken(name: string): number {
  const match = ruleBody(appCss, ":root").match(
    new RegExp(`--z-timeline-${name}: (\\d+);`),
  );
  assert.ok(match, `missing --z-timeline-${name}`);
  return Number(match[1]);
}

describe("selected clip ring", () => {
  it("defines a neutral selection ring token", () => {
    const ring = ruleBody(tokensCss, ":root").match(
      /--selection-ring: #([0-9a-f]{6});/,
    );
    assert.ok(ring, "missing --selection-ring");
    // Near-white: every channel is bright and they barely differ, so the ring
    // has no hue a palette accent could share.
    const channels = [0, 2, 4].map((at) =>
      Number.parseInt(ring[1].slice(at, at + 2), 16),
    );
    assert.ok(Math.min(...channels) >= 0xe0, ring[1]);
    assert.ok(Math.max(...channels) - Math.min(...channels) <= 0x20, ring[1]);
  });

  it("rings, haloes and lifts the selected clip, and focus shares it", () => {
    const rule = ruleBody(
      clipCardCss,
      ".clip-card--selected,\n.clip-card:has(:focus-visible)",
    );
    assert.match(rule, /outline: 2px solid var\(--selection-ring\);/);
    assert.match(rule, /outline-offset: 1px;/);
    assert.match(rule, /0 0 0 4px rgba\(0, 0, 0, 0\.55\)/);
    assert.match(rule, /0 6px 14px rgba\(0, 0, 0, 0\.45\)/);
    assert.match(rule, /z-index: var\(--z-timeline-selected-clip\);/);
    assert.match(
      ruleBody(clipCardCss, ".clip-card--selected"),
      /transform: translateY\(-1px\);/,
    );
    assert.match(
      ruleBody(clipCardCss, ".clip-card :focus-visible"),
      /box-shadow: none;/,
    );
  });

  it("rings, haloes and lifts a selected source clip the same way", () => {
    const rule = ruleBody(sourceSpanCss, ".source-span--selected");
    assert.match(rule, /outline: 2px solid var\(--selection-ring\);/);
    assert.match(rule, /outline-offset: 1px;/);
    assert.match(rule, /0 0 0 4px rgba\(0, 0, 0, 0\.55\)/);
    assert.match(rule, /0 6px 14px rgba\(0, 0, 0, 0\.45\)/);
    assert.match(rule, /z-index: var\(--z-timeline-selected-clip\);/);
    assert.match(rule, /transform: translateY\(-1px\);/);
  });

  it("leaves unselected clips without a ring", () => {
    const base = ruleBody(clipCardCss, ".clip-card");
    assert.doesNotMatch(base, /outline|box-shadow|z-index/);
  });

  it("stacks the selected clip under the range selection and playhead", () => {
    const clip = zToken("selected-clip");
    assert.ok(clip > 0);
    assert.ok(clip < zToken("selection"));
    assert.ok(zToken("selection") < zToken("playhead"));
  });

  it("does not ring the selected clip in its accent color", () => {
    assert.doesNotMatch(clipCardTsx, /0 0 0 2px \$\{clip\.accent\}/);
    assert.match(clipCardTsx, /selected \? "clip-card--selected" : ""/);
  });
});

// Hovering or trimming one edge shows that edge's handle, not both (#925).
describe("trim handle highlight", () => {
  it("shows only the hovered or trimmed arrangement clip handle", () => {
    assert.match(
      ruleBody(
        clipCardCss,
        ".clip-card__handle:hover,\n.clip-card:has(:focus-visible) .clip-card__handle,\n.clip-card__handle--trimming",
      ),
      /opacity: 1;/,
    );
    assert.doesNotMatch(clipCardCss, /\.clip-card:hover \.clip-card__handle/);
    assert.doesNotMatch(
      clipCardCss,
      /\.clip-card--trimming \.clip-card__handle/,
    );
  });

  it("shows only the hovered or trimmed source clip handle", () => {
    assert.match(
      ruleBody(
        sourceSpanCss,
        ".source-span__handle:hover,\n.source-span__handle--trimming",
      ),
      /opacity: 1;/,
    );
    assert.doesNotMatch(
      sourceSpanCss,
      /\.source-span:hover \.source-span__handle/,
    );
    assert.doesNotMatch(
      sourceSpanCss,
      /\.source-span--trimming \.source-span__handle/,
    );
  });
});
