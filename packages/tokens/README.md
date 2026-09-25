# @zvid/tokens

Shared design tokens and bundled fonts for the `/app` editor and the ZVID
Capture plugin UI (`daw/ui`). See [`daw/DESIGN.md`](../../daw/DESIGN.md) for
what each token means.

```css
@import '@zvid/tokens/tokens.css';
```

`tokens.css` defines the shared `:root` variables and the `@font-face` rules
for Space Grotesk (400, 500, 700) and IBM Plex Mono (400, 500, 600). The fonts
are bundled as latin and latin-ext WOFF2 subsets from
[Fontsource](https://fontsource.org) 5.3.0 so neither product loads fonts from
the network. Both families are licensed under the SIL Open Font License 1.1,
which permits bundling and redistribution; the license texts are in
[`fonts/`](fonts).

Keep product-specific variables (for example the `/app` lane-selection
colours) in that product's own stylesheet.
