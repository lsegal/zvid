import type { Guide } from "./types";

export const motion: Guide = {
  id: "motion",
  title: "Animation and modulation",
  accent: "violet",
  summary:
    "zvid doesn't use keyframes. Instead, each effect gets an **Animation** section that moves its knobs: in and out with each clip, on every kick drum, or in time with the tempo.",
  sections: [
    {
      id: "basics",
      title: "Turning on Animation",
      blocks: [
        {
          type: "p",
          text: "Every video device that can move has an **Animation** toggle beside its power button. Turn it on and an Animation section attaches to the device's right edge, with three modes: **Clip**, **Reactive** and **LFO**. Turning it off keeps your settings for next time. Knobs that Animation is moving get a colored arc so you can see them at a glance.",
        },
        {
          type: "list",
          items: [
            "Most effects start with Animation on when you add them. Move, Exposure, Contrast, LUT, Levels and Shape start with it off.",
            "Order and Transition only have Clip mode.",
            "Layout, Mask, Scopes and Retime don't animate.",
          ],
        },
        {
          type: "p",
          text: "A small trace in the Animation title draws what the knobs are doing: the in-and-out curve across a clip, the recent swings on hits, or the LFO's wave. It moves while you play.",
        },
        {
          type: "video",
          id: "reactive-fx",
          caption:
            "Bloom added to the Global stack and set to **Reactive**: it flares on every kick.",
        },
      ],
    },
    {
      id: "clip-mode",
      title: "Clip mode",
      blocks: [
        {
          type: "p",
          text: "The effect animates in as each clip starts and back out as it ends, running its knobs from \"no visible effect\" up to where you set them. On a layer or Global stack, it follows each clip the effect is drawn on. Clip edges on the session's first or last frame don't animate.",
        },
        {
          type: "table",
          compact: true,
          head: ["Control", "Options (default)"],
          rows: [
            [
              "Timing",
              "Slow, Normal, Fast or Full (Normal). Full eases in until the middle of the clip and back out by its end. Short clips shorten both sides to fit.",
            ],
            [
              "Motion In · Motion Out",
              "None, Linear, Ease In, Ease Out or Ease In Out. Most effects ease out on the way in and ease in on the way out.",
            ],
            [
              "Transition (Order only)",
              "**Push** slides layers in from the canvas edge, **Squish** grows them from nothing (Squish).",
            ],
          ],
        },
        {
          type: "figure",
          shot: "motion-order",
          alt: "An Order device on an FX clip with its Animation section in Clip mode, showing Timing, Motion In, Motion Out and Push or Squish.",
          caption:
            "An **Order** on an FX clip animates the split-screen in and out, with **Push** or **Squish** entrances.",
        },
        {
          type: "p",
          text: "Timing is counted in frames at your session's frame rate. Normal is about 8 frames for most color and transform effects, 6 for glitches and blurs, and longer for Zoom & Pan and Shape.",
        },
      ],
    },
    {
      id: "reactive",
      title: "Reactive mode",
      blocks: [
        {
          type: "p",
          text: "Reactive mode listens to the session's audio. On each hit it kicks the chosen knobs by a random amount, then lets them settle back along the Motion curve. The detector listens to the low band of the mix, under 250 Hz, so kicks and bass notes drive it. Preview and export react identically.",
        },
        {
          type: "figure",
          shot: "motion-reactive",
          alt: "Pixelate on the MIDI sample's logo text, with its Animation section in Reactive mode: Timing, Reactivity, Amplitude, Motion and Parameters.",
        },
        {
          type: "table",
          compact: true,
          head: ["Control", "Range (default)"],
          rows: [
            [
              "Timing",
              "Slow, Normal, Fast: how long each kick takes to settle (Normal)",
            ],
            [
              "Reactivity",
              "0–100% (100%). Lower values let only stronger hits through.",
            ],
            [
              "Amplitude",
              "−10× to 10×. At 1×, a knob swings up to a quarter of its range; negative values swing the other way.",
            ],
            [
              "Motion",
              "**Bounce** is one push that settles, **Wobble** a damped swing both ways, **Single** one smooth rise and fall, **None** a jump.",
            ],
            [
              "Parameters",
              "Which knobs move. Each effect starts with its most expressive ones, like Pixel Size on Pixelate or Hue Shift on Colorize.",
            ],
          ],
        },
        {
          type: "figure",
          shot: "motion-parameters",
          alt: "The Parameters menu open on an Animation section, with a checkbox for each of the effect's knobs.",
          width: 560,
        },
        {
          type: "note",
          tone: "tip",
          text: "Hits are spaced at least 80 ms apart, and a hit during a swing restarts it at the stronger level. Fast four-on-the-floor kicks give a steady pulse; sparse hits give big, separate jumps.",
        },
      ],
    },
    {
      id: "lfo",
      title: "LFO mode",
      blocks: [
        {
          type: "p",
          text: "An LFO moves the chosen knobs in a steady wave, locked to the tempo or at a free rate.",
        },
        {
          type: "figure",
          shot: "motion-lfo",
          alt: "Gaussian Blur with its Animation section in LFO mode: Sync, Shape, Rate, Depth and Phase.",
        },
        {
          type: "table",
          compact: true,
          head: ["Control", "Options (default)"],
          rows: [
            ["Sync", "On locks the rate to the tempo (On)"],
            [
              "Shape",
              "Sine, Triangle, Saw Up, Saw Down, Square or Random (Sine)",
            ],
            [
              "Rate, synced",
              "4 Bars, 2 Bars, 1 Bar, 1/2, 1/4, 1/8, 1/16 and 1/32, each with dotted (D) and triplet (T) values down to 1/16 (1/8). Bars follow the time signature.",
            ],
            ["Rate, free", "0.05–20 Hz (1 Hz)"],
            ["Depth", "−10× to 10×. Negative values flip the wave."],
            [
              "Phase",
              "0–360° (0°). Offset two effects to make them alternate.",
            ],
          ],
        },
      ],
    },
    {
      id: "audio-modulation",
      title: "Modulating audio effects",
      blocks: [
        {
          type: "p",
          text: "Audio devices have the same idea under the name **Modulation**, with two modes. **Transient** works like Reactive but listens to the effect's own input, so a Low Cut on the drums can open on each snare. **LFO** works just as it does for video. Every audio effect supports it except Reverse and Re-Pitch.",
        },
        {
          type: "figure",
          shot: "audio-modulation",
          alt: "The Compressor with its Modulation section attached in Transient mode.",
        },
        {
          type: "p",
          text: "More in [Audio and mixing](../audio/#modulation).",
        },
      ],
    },
    {
      id: "keyframes",
      title: "What about keyframes?",
      blocks: [
        {
          type: "p",
          text: "There's no keyframe or automation lane. For a hand-placed path, use **Move**: set a Start and End placement and add up to four waypoints along a straight or curved path, with a Motion curve across the clip. For everything else, Clip, Reactive and LFO cover the moves you'd usually keyframe, and they follow your edits and tempo automatically.",
        },
      ],
    },
  ],
};
