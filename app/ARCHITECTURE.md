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
- `editor.tsx` renders the desktop editor wired through App's hooks
  (`renderEditor`), with sessions to open it with (`sessionWithLayers`,
  `withTestPatternTrack`, `withMedia`); `preview: true` adds the
  preview. `editor-steps.ts` holds steps several editor tests share, such
  as inserting a text clip or creating a loop. Prefer rendering the single
  component you test; render the editor only when the behavior needs App's
  hooks wired together, such as undo, menus, keyboard shortcuts or drags
  across rows. Such a test still imports the component it covers, and uses
  `EDITOR_TEST_TIMEOUT`.

To keep changed-only selection accurate:

- Import the component or module you cover. A test that renders a
  component through something else is selected through that something too.
- Render inside the shell whose CSS you rely on, so the test imports that
  CSS.
- Keep global CSS in `setup.ts`. A change to a global stylesheet, the
  tokens or the setup file reruns the whole suite; the list is
  `GLOBAL_TRIGGERS` in `vitest.config.ts`, which must stay in step with the
  setup file's imports.

### Component tests in CI

The `component-tests` job in `.github/workflows/ci.yml` runs only the
component tests affected by a change:

- On a pull request, against the merge base with `main`.
- On a push to `main`, against the commit `main` pointed at before the
  push. A new branch or an unreachable `before` commit runs the whole
  suite.
- A manual run (`workflow_dispatch`) with `full-component-suite` set runs
  the whole suite.

When no test is affected, the job passes without running any.
