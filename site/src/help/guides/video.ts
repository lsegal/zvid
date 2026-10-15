import type { Guide } from "./types";

export const video: Guide = {
  id: "video",
  title: "Video and compositing",
  accent: "cyan",
  summary:
    "A GPU compositor with effect stacks on every clip, layer and the whole frame. FX clips act like adjustment layers, layers can mask each other, and you transform, title and grade right in the preview.",
  sections: [
    {
      id: "compositing",
      title: "How the picture is built",
      blocks: [
        {
          type: "list",
          items: [
            "**Layer 1 draws on top.** Each lower layer draws beneath it, with normal transparency.",
            "**Order** (on the Global stack of every session) arranges layers into bands, columns or a grid. Turn it off and every layer covers the whole frame, so they overlap.",
            "**Layout** sits on every layer and anchors the picture within its slot: Center, Top or Bottom.",
          ],
        },
        { type: "h3", text: "Effect stacks" },
        {
          type: "table",
          compact: true,
          head: ["Stack", "Applies to"],
          rows: [
            ["Clip", "That clip, first."],
            ["Layer", "Each of the layer's clips."],
            ["Global", "The finished frame."],
            [
              "FX clip",
              "Everything beneath it, for the clip's time and inside its box.",
            ],
          ],
        },
        {
          type: "p",
          text: "A layer clip also inherits its source track's and source clip's effects, ahead of its own. The FX panel shows the stacks left to right as **Global**, the layer, then **Clip**. Turning a layer's FX off (its **fx** button, or **Disable FX** in its menu) bypasses its effects; content devices like Layout, Color and Text still apply.",
        },
        { type: "h3", text: "FX clips" },
        {
          type: "p",
          text: 'An FX clip is an adjustment clip with no picture of its own. Its effects apply to the layers beneath it while it plays, and its label lists them, like "FX · Colorize, Pixelate". Drag a range on a layer and choose **Insert FX Clip**, or use **Insert FX clip at playhead** from the layer menu.',
        },
        {
          type: "list",
          items: [
            "Add an **Order** to an FX clip to rearrange the layers beneath it for just that stretch.",
            "Add a **Mask** to limit where its effects apply, **Opacity** to mix them, or **Transform** and **Move** to move the box it adjusts.",
            "Add a **Transition** to blend between what's beneath it at its start and at its end. See [Transitions](#transitions).",
          ],
        },
        { type: "h3", text: "Masks" },
        {
          type: "p",
          text: "Add a **Mask** to a layer and pick a **Target** layer. In **Additive** mode the layer only shows where the target draws; in **Subtractive** mode the target's shape is cut out of it. The target still draws normally, unless it's hidden, in which case it's used only as the mask.",
        },
      ],
    },
    {
      id: "adding-effects",
      title: "Adding effects",
      blocks: [
        {
          type: "p",
          text: "Click **+** at the end of a stack, or right-click a layer header › **Add FX**. The Add menu groups video effects into Transform, Color, Blur, Distort, Glitch, Stylize and Text, each with a one-line description. Devices work the same way as audio ones: bypass, collapse, drag to reorder or to another stack, and double-click a knob to reset it. See [Working with devices](../audio/#devices).",
        },
        {
          type: "figure",
          shot: "video-add-menu",
          alt: "The Add menu on a layer with the Video group's Color category open, listing Colorize, Exposure, Contrast, Levels, Scopes, LUT, Opacity and Color.",
          width: 760,
        },
      ],
    },
    {
      id: "effects",
      title: "Video effects",
      blocks: [
        {
          type: "p",
          text: "Every video effect, with its controls and defaults. Pixel sizes are at 1080p and scale with your canvas.",
        },
        { type: "h3", text: "Transform" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Transform**: moves, resizes and rotates.",
              "X, Y ±200% (0) · Width, Height 5–800% (100%) · Origin X, Y ±100% (0) · Rotation ±180° (0°)",
            ],
            [
              "**Move**: travels from a start to an end placement over each clip, optionally through up to four waypoints.",
              "Motion Linear, Ease In, Ease Out, Ease In Out (Ease In Out) · Start, Points 1–4 and End, each with Transform's controls · Path Lines or Curve (Curve)",
            ],
            [
              "**Zoom & Pan**: a Ken Burns move.",
              "Start Zoom 1–4× (1×) · Start X, Y (50%) · End Zoom (1.2×) · End X, Y (50%)",
            ],
            [
              "**Shape**: draws the layer inside a shape, or along its outline.",
              "Shape Rectangle, Oval, Star, Arrow or Custom (from SVG media) · Stroke 0–200 px (0 = filled) · Dash, Gap, Offset · Drawn 0–100% (100%)",
            ],
            [
              "**Order**: arranges layers in rows, columns or a grid. Global and FX clips.",
              "Order Vertical, Horizontal, Grid · Layers checklist · Grid Size 2×2–6×6 · Spacing, Margin 0–200 px · Border color",
            ],
            [
              "**Layout**: anchors the picture in its slot. One per layer.",
              "Position Center, Top, Bottom (Center)",
            ],
            ["**Mask**", "Target layer · Mode Additive or Subtractive"],
            [
              "**Retime**: speed, freeze or reverse a clip's video, GIF or Lottie. Clips only.",
              "Speed −5× to 5× (1×), where 0 freezes and negative plays backwards · Interpolation None or Blend",
            ],
            [
              "**Transition**: FX clips only.",
              "See [Transitions](#transitions)",
            ],
          ],
        },
        { type: "h3", text: "Color" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Levels**: grade with color wheels and curves.",
              "Lift, Gamma, Offset −1–1 (0) and Gain 0–4 (1) wheels, each with Y, R, G, B values · Master, R, G, B curves over a live histogram",
            ],
            [
              "**LUT**: grade through a 3D lookup table.",
              "LUT: None, a built-in look, or an imported `.cube` · Intensity 0–100% (100%)",
            ],
            ["**Exposure**", "Exposure −4 to +4 EV (0)"],
            ["**Contrast**", "Contrast 0–2 (1) · Pivot 0–1 (0.435)"],
            ["**Colorize**: shifts the hue.", "Hue Shift ±360° (0°)"],
            ["**Opacity**", "Opacity (100%)"],
            [
              "**Color**: paints fill clips.",
              "Type Solid or Gradient · Color or Gradient · Opacity",
            ],
            [
              "**Scopes**: view only.",
              "Shows an RGB waveform of the picture at that point in the stack",
            ],
          ],
        },
        {
          type: "figure",
          shot: "video-levels",
          alt: "The Levels device: Lift, Gamma, Gain and Offset color wheels beside a tone curve over a histogram.",
          caption:
            "**Levels**: drag a wheel's puck to tint and its ring to adjust the master; double-click to reset. Click the curve to add points, and double-click or press [[Delete]] to remove one.",
        },
        {
          type: "p",
          text: "The **LUT** picker offers **Built-in** looks (Black & White Film, Sepia, Faded Vintage Print, Warm 70s Film, Cool 90s Film, Bleach Bypass, Cross-Processed, Two-Strip Color, High-Contrast Film and Teal & Orange) and any `.cube` files you've imported as media. LUTs must be 3D, sized 2 to 256.",
        },
        {
          type: "figure",
          shot: "video-lut",
          alt: "The LUT device with its picker open, listing None, the built-in looks and imported media.",
          width: 640,
        },
        { type: "h3", text: "Blur, Distort and Glitch" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            ["**Gaussian Blur**", "Radius 0–100 px (20)"],
            [
              "**Motion Blur**: a directional smear.",
              "Angle 0–180° (0°, horizontal) · Distance 0–400 px (60)",
            ],
            ["**Pixelate**", "Pixel Size (50%)"],
            [
              "**Distortion**: waves, ripples, twirls and bulges.",
              "Type Wave, Ripple, Twirl, Bulge, Fisheye, Turbulence · Edges Clamp, Mirror, Transparent · Amount ±100% (30%) · Size · Speed · Angle (Wave) · Center X, Y",
            ],
            [
              "**Refraction**: the picture through water or glass.",
              "Type Water, Frosted Glass, Reeded Glass, Glass Blocks · Amount · Scale · Speed (Water) · Angle (Reeded) · Dispersion",
            ],
            [
              "**Analog Glitch**: tape jitter and color bleed.",
              "Low (0%) · High (50%)",
            ],
            [
              "**Digital Glitch**: blocky corruption.",
              "Amount · Block Size · Displace · Channel Shift · Color Crush · Rate 1–30/s (8)",
            ],
          ],
        },
        { type: "h3", text: "Stylize" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Bloom**: bright areas glow.",
              "Threshold (70%) · Intensity 0–200% (60%) · Radius (40%) · Tint",
            ],
            [
              "**Caustics**: animated underwater light.",
              "Intensity · Scale · Speed · Warp · Color · Blend Add, Screen or Multiply (Screen)",
            ],
            [
              "**Negative Split**: inverts a brightness range.",
              "Low (0%) · High (100%)",
            ],
          ],
        },
      ],
    },
    {
      id: "text",
      title: "Text and titles",
      blocks: [
        {
          type: "p",
          text: "A text clip's **Text** device holds the words and every style control. Double-click the text in the preview (or select it and press [[Enter]]) to type right on the canvas. [[Enter]] adds a line, [[Esc]] or [[⌘/Ctrl]] + [[Enter]] finishes, [[⌘/Ctrl]] + [[B]], [[I]], [[U]] toggle bold, italic and underline, and [[⌘/Ctrl]] + [[Shift]] + [[>]] or [[<]] changes the size.",
        },
        {
          type: "figure",
          shot: "video-text-edit",
          alt: "Typing Hello, zvid directly on the preview canvas.",
          width: 520,
        },
        {
          type: "table",
          compact: true,
          head: ["Control", "Options (default)"],
          rows: [
            [
              "Font and Weight",
              "Any weight the font has, Thin to Black (Regular)",
            ],
            ["Style", "Bold, Italic, Underline, Strikethrough, All caps"],
            [
              "Align · Vertical",
              "Left, Center, Right, Justify (Center) · Top, Middle, Bottom (Middle)",
            ],
            ["Resize to fit", "Shrinks the text to fit its box (Off)"],
            ["Path", "None or Circle, with a Radius"],
            ["Fill", "Solid color (white) or a Gradient"],
            ["Stroke", "Color, width 0–20 px, and Dash, Gap, Offset"],
            ["Shadow", "Color, Blur, X and Y (Off)"],
            [
              "Size · Leading · Tracking · Padding",
              "8–600 px (96) · 0.6–3× (1.2×) · −0.2–1 em (0) · 0–200 px",
            ],
          ],
        },
        {
          type: "p",
          text: "The font picker searches three groups: **Bundled** fonts (Inter, Montserrat, Playfair Display, Bebas Neue, Anton, Space Grotesk, IBM Plex Mono), popular **Google Fonts** (and any other family by name), and **Local** fonts on your computer. Local fonts may look different for collaborators who don't have them.",
        },
      ],
    },
    {
      id: "transitions",
      title: "Transitions",
      blocks: [
        {
          type: "p",
          text: "A **Transition** lives on an FX clip and blends from what's beneath the clip at its start to what's beneath it at its end. Put an FX clip across the cut between two clips and add a Transition to it. Its timing comes from its Animation section: **Full** (the default) spans the whole FX clip, while Slow, Normal and Fast take 30, 20 and 10 frames, centered.",
        },
        {
          type: "figure",
          shot: "video-transition",
          alt: "The Transition device on an FX clip with its type menu and options, and its Animation section beside it.",
        },
        {
          type: "table",
          compact: true,
          head: ["Type", "Options"],
          rows: [
            [
              "Fade, Dissolve, Dissolve (Noise), Zoom, Page Curl, Twirl, Ripple, Zoom Blur, Spin, Morph, Pixelate, Glitch, Dip to White",
              "None",
            ],
            [
              "Swipe, Push, Reveal, Cover, Flip, Cube",
              "Direction: Left, Right, Up, Down",
            ],
            ["Wipe", "Direction, Softness"],
            [
              "Iris, Iris (Box), Diamond, Star, Heart",
              "Iris: Out or In · Softness",
            ],
            ["Blinds", "Orientation · Count 2–32 · Softness"],
            ["Barn Door", "Orientation · Softness"],
            ["Split", "Orientation"],
            ["Checkerboard", "Count"],
            ["Clock Wipe, Burn", "Softness"],
            ["Radial Wipe", "Origin: Center or a corner · Softness"],
          ],
        },
      ],
    },
    {
      id: "media",
      title: "Fills, images and animation",
      blocks: [
        {
          type: "list",
          items: [
            "**Fill clips** draw a rectangle over the layer's slot, painted by their Color device.",
            "**Lottie** `.json` and **dotLottie** `.lottie` files import as media and play as vector animations. The MIDI sample's Sky and Train tracks are Lottie.",
            "Animated **GIF**, **WebP**, **PNG** and **AVIF** images play as animations.",
            "**SVG** files can be used as a custom Shape.",
            "**Retime** speeds up, slows, freezes or reverses any of these, as well as video.",
          ],
        },
      ],
    },
    {
      id: "preview",
      title: "The preview monitor",
      blocks: [
        {
          type: "p",
          text: "The preview has two tabs: **Timeline** shows the program, headed **Program** and the clip under the playhead, and **Media** plays whatever you've picked in the Media drawer. Drag the splitter between the timeline and the preview to resize it; double-click to reset.",
        },
        { type: "h3", text: "Transform on the canvas" },
        { type: "video", id: "transform" },
        {
          type: "table",
          compact: true,
          head: ["To", "Do this"],
          rows: [
            [
              "Select",
              "Click the topmost layer under the pointer. [[Esc]] deselects.",
            ],
            [
              "Move",
              "Drag it. Hold [[Shift]] to lock to one axis. Arrow keys nudge 1 px, [[Shift]] + arrows 10 px.",
            ],
            [
              "Resize",
              "Drag one of the eight handles. [[Shift]] keeps the aspect ratio, [[⌘/Ctrl]] resizes from the center. Edges snap to the canvas edges and center lines.",
            ],
            [
              "Rotate",
              "Drag the handle above the box, or just outside a corner. [[Shift]] snaps to 15°. Double-click the handle to straighten.",
            ],
            [
              "Move the pivot",
              "Drag the origin marker. Double-click it to center.",
            ],
          ],
        },
        {
          type: "p",
          text: "Edits go to the selected clip's own Transform (added on your first edit), or to the layer's Transform when only a layer is selected.",
        },
        {
          type: "figure",
          shot: "video-transform",
          alt: "The preview with a layer selected, showing its eight resize handles, rotation handle and origin marker.",
          width: 480,
        },
        { type: "h3", text: "Scopes" },
        {
          type: "p",
          text: "Click **Scopes** in the preview header to open a resizable panel under the monitor with **Waveform**, **Parade**, **Vectorscope** (with 75% color targets and a skin-tone line) and **Histogram**. Scopes follow the Media tab too.",
        },
        {
          type: "figure",
          shot: "video-scopes",
          alt: "The Scopes panel under the preview showing a vectorscope during playback.",
          width: 480,
        },
      ],
    },
    {
      id: "canvas",
      title: "Canvas and frame rate",
      blocks: [
        {
          type: "p",
          text: "Open **File › Session Settings…** ([[⌘/Ctrl]] + [[,]], or click the resolution in the status bar) to set the canvas and timing. zvid also picks them up from the first video you import.",
        },
        {
          type: "list",
          items: [
            "**Canvas**: 1080p 16:9 (1920 × 1080), 1080 × 1920 9:16, 1080 × 1080 1:1, 4K 16:9, 720p 16:9, or a custom size from 16 to 7680, with aspect lock and a swap button.",
            "**Frame rate**: 23.976, 24, 25, 29.97, 30, 50, 59.94 or 60 fps, or a custom rate.",
            "**Session length**: set where the timeline, preview and export end, or leave it to end with the last clip.",
          ],
        },
        {
          type: "figure",
          shot: "video-session-settings",
          alt: "The Session Settings dialog with Canvas, Timing, Video encoding and Audio sections.",
          width: 560,
        },
      ],
    },
  ],
};
