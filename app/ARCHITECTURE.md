# zvid app: architecture

This document records how the web and desktop editor in `/app` is built and
tested. The DAW plugin has its own document,
[`daw/ARCHITECTURE.md`](../daw/ARCHITECTURE.md).

## Testing

The app has three test suites:

| Suite | Command | Runs | Covers |
| --- | --- | --- | --- |
| Unit | `pnpm test:unit` | `node --test` on `src/**/*.test.ts` | Logic without a DOM |
| Component | `pnpm test:component` | Vitest browser mode on `src/**/*.component.test.tsx`, in Chromium | Components rendered with their real CSS |
| End to end | `pnpm test:web` | Playwright on `e2e/*.spec.ts` against the built app | Whole-app flows |

### Write Vitest component tests first

**Write a Vitest component test first.** Use a Playwright e2e spec only when
a component test can't capture the full behavior, such as a flow across the
whole app, real media playback or export, or collaboration between two
pages. Say why in a one-line comment at the top of the spec.

Component tests are cheaper to run and CI selects them by what changed
([#1227](https://github.com/lsegal/zvid/issues/1227)). An e2e spec loads the
app by URL, so no tool can tell which specs a change affects; a component
test imports what it covers, so `vitest --changed` follows the real module
graph, stylesheets included.

### Writing a component test

Name the file `<Component>.component.test.tsx` and put it beside the
component. The harness lives in `src/component-test/`:

- `setup.ts` imports the global CSS (`index.css`, `text-fonts.css`,
  `App.css`, `coarse-pointer.css`, and through `index.css` the shared
  tokens) before every test. Keep global CSS there, not in tests.
- `shells.tsx` wraps a component in the parent classes that layout-level
  CSS styles it through, and imports that CSS. Render inside `PhoneShell`
  to test the phone layout (`.app-shell--phone` and the `mobile-*.css`
  stylesheets). Tablets keep the desktop layout, which `coarse-pointer.css`
  adapts to touch, so there is no tablet shell.
- `viewport.ts` sets the viewport and emulates touch: `usePhone`,
  `useTablet`, `setViewport` and `emulateTouch`. Touch emulation makes
  `(pointer: coarse)` and `(hover: none)` match. The setup file restores the
  desktop viewport and a mouse after each test.
- `input.ts` sends trusted input through the Chrome DevTools Protocol, so
  the browser hit tests, captures pointers and fires `click` and
  `contextmenu` itself: a mouse with any button and modifiers whose moves
  report the held buttons (drags, pointer capture), touches, keyboard
  helpers (`undo`, `redo`, `pressShiftF10`) and menu helpers (`menuItem`,
  `openLayerMenu`, `addLayers`). It releases buttons a test leaves down.
  `commands.ts` adds Playwright's mouse as browser commands, which `app.tsx`
  exposes as `mouse`.

Render the least that shows the behavior:

1. The component itself, in a shell if its CSS needs one, when the test
   needs only its rendering, styles and props.
2. `renderEditor` (`editor.tsx`) when the behavior needs App's hooks wired
   together around the timeline, such as undo, menus, keyboard shortcuts or
   drags across rows. It renders the desktop editor through those hooks
   without the preview and the rest of App (`preview: true` adds the
   preview), so the test imports the component it covers and `vitest
   --changed` selects it for that component's changes. It opens sessions
   from `sessionWithLayers`, `withTestPatternTrack` and `withMedia`;
   `editor-steps.ts` holds steps several such tests share, such as
   inserting a text clip or creating a loop. Use `EDITOR_TEST_TIMEOUT`.
3. `renderApp` (`app.tsx`) when it needs the whole App: behavior that
   crosses App-level state outside the timeline, such as selection shared
   by the timeline, the FX panel and the arrangement, or dropped media
   (`fixtureFile`, `dropFiles`). A test that renders it imports App, so any
   change under App selects it. App imports the wasm export bridge, so
   build `export-bridge/pkg` first.

To keep changed-only selection accurate:

- Import the component or module you cover. A test that renders a
  component through something else is selected through that something too.
- Render inside the shell whose CSS you rely on, so the test imports that
  CSS.
- Keep global CSS in `setup.ts`. A change to a global stylesheet, the
  tokens or the setup file reruns the whole suite; the list is
  `GLOBAL_TRIGGERS` in `vitest.config.ts`, which must stay in step with the
  setup file's imports.

### Running tests locally

Local test runs cover what a change affects, never the whole suite by
default. Proving a change correct doesn't need a full local run: the tests
the change selects are the expected local verification, and the full suites
are for CI and deliberate manual runs.

`pnpm test:component` runs only the component tests affected by the
branch's changes, committed and uncommitted, since its merge base with
`main` (`origin/main`, or `main` when there is no remote), as CI does for a
pull request. When nothing is affected it passes without running any. Pass
test file filters or `--changed`/`--related` to pick tests yourself, and
`--all` to run the whole suite. Other arguments go to `vitest run`.

### Component tests on Linux

Run the suite with `pnpm test:component` (`scripts/component-tests.mjs`),
which CI runs too. On Linux it runs Chromium headed: headless Chromium there
has no pointer device, so once a test turns touch emulation off,
`(hover: none)` keeps matching for every later test file and hover tests
fail. It runs under `xvfb-run` when Xvfb is installed (`apt-get install
xvfb`), on the desktop's display otherwise, and fails with a pointer to Xvfb
when there is neither. Running `vitest` headless on Linux directly fails the
first test that turns touch off, with the same pointer.

### Component tests in CI

`component-select` in `.github/workflows/ci.yml` picks the component tests
affected by a change, and `component-tests` runs them:

- On a pull request, against the merge base with `main`.
- On a push to `main`, against the commit `main` pointed at before the
  push. A new branch or an unreachable `before` commit runs the whole
  suite.
- A manual run (`workflow_dispatch`) with `full-suite` set runs the whole
  suite (`pnpm test:component --all`).

A shared component, such as one the `renderEditor` timeline renders, selects
every test that renders it, often dozens of files. Headed Chromium (see
above) runs one test file at a time, so `component-tests` splits the
selection into shards of about 15 files, at most 6, that run in parallel
(`componentTestShards` in `scripts/component-tests.mjs`). When no test is
affected, one shard passes without running any.

### Playwright specs in CI

The remaining e2e specs run the same way, by what changed, never as a full
run on a pull request or a push. `e2e-select` lists the specs that
`playwright test --only-changed` picks against the same commit as the
component tests: specs that changed, or that import a changed file such as
a helper or a module the spec loads in Node. A spec loads the app by URL, so
a change to app code alone selects no spec; covering app code is the
component tests' job. A change to `playwright.config.ts`, the app lockfile
or `e2e/fixtures` selects every spec.

- `e2e` runs the selected specs in Chromium, in one job.
- `e2e-webkit` runs the selected `WEBKIT_SPECS` in WebKit on macOS.

Both pass without running anything when no spec is selected. A manual run
with `full-suite` set runs every spec in both, unsharded; it is slow.

## Preview performance

### Many small animated clips

A clip whose Transform shrinks it is framed and rasterized at the size it is
drawn, not its whole slot (`composition-framing.ts`). A transformed clip
with no effects of its own, whose source fills its slot, such as a fill, is
drawn straight onto the canvas with no offscreen pass, and gradient fills
painted alike are drawn once for every clip that uses them.

What sets the cost of hundreds of clips is then the GPU's render passes,
not pixels or JavaScript. Every clip that runs a shader effect of its
own, such as a Shape or a blur (Color, Layout, Transform and Move are not
shader effects), is framed offscreen and filtered there, and each such pass
costs a roughly fixed amount however small the clip.

`composition-stress.html` measures it: start the dev server and open
`/composition-stress.html?autorun&dots=300`, with `dot=shape` (a solid fill
cut to an Oval Shape), `dot=gradient` (a hard-edged radial gradient, no
effect) or `dot=square` (no effect), and `ratio` for the preview's pixel
ratio. Each dot is a fill clip on its own layer with an LFO on its
Transform's Position Y. On an Apple M1 in headed Chromium, at 1920×1080:

| Dots | Each dot | Frame time, median |
| --- | --- | --- |
| 300 | gradient, no effect | 6.5 ms |
| 600 | gradient, no effect | 9.9 ms |
| 300 | solid, no effect | 5.3 ms |
| 150 | solid, cut to a Shape | 28 ms |
| 300 | solid, cut to a Shape | 51 ms |

Before the framing change, 300 Shape dots took 192 ms a frame and 600
gradient dots took 6.9 s to draw for the first time.

The budget, for the opening sample and any generated project, at 30 fps:

- Effect-free transformed clips cost about 0.01 ms each: hundreds at once
  play at full frame rate. Make dots round with a radial-gradient fill, not
  a Shape.
- A clip running its own shader effects costs about 0.17 ms a frame at any
  size.
  Keep at most about 100 of them on screen at once, half a 30 fps frame,
  leaving the rest for video, text and the Global chain.
- Put an effect that should apply to many clips on an FX clip above them,
  which runs once, rather than on every clip.
