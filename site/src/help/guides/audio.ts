import type { Guide } from "./types";

export const audio: Guide = {
  id: "audio",
  title: "Audio and mixing",
  accent: "mint",
  summary:
    "Every clip, track and the whole session has its own effect chain. Instruments play your MIDI, twenty-two audio effects shape the sound, and what you hear in the preview is exactly what you export.",
  sections: [
    {
      id: "signal-flow",
      title: "How sound flows",
      blocks: [
        {
          type: "p",
          text: "zvid mixes like a console. Each clip runs through its own effects, the clips on a layer or source track are summed into that row's bus, and every bus is summed into the master, which runs the **Global** stack. A fixed soft limiter sits at the very end so the mix never goes over 0 dBFS.",
        },
        {
          type: "table",
          compact: true,
          head: ["Stack", "What it processes"],
          rows: [
            ["Clip", "That clip alone. Reverse and Re-Pitch live only here."],
            [
              "Layer or Track",
              "The sum of every clip on the row, like a channel strip.",
            ],
            ["Global", "The whole mix, just before the master limiter."],
          ],
        },
        {
          type: "figure",
          shot: "audio-chain",
          alt: "The FX panel for the Drums clip, showing Global, Track and Clip sections with a Drum Rack, Gain, Compressor and Saturation.",
          caption:
            "The FX panel for a selected clip reads left to right: **Global**, then the **Track** (or **Layer**), then the **Clip**. The Drums clip in the MIDI sample runs a Drum Rack, Gain, Compressor and Saturation.",
        },
        { type: "h3", text: "What you hear" },
        {
          type: "list",
          items: [
            "If any clip on a layer has sound, the layers are what you hear and the source tracks stay quiet. Otherwise every source clip with sound plays. MIDI clips count as sound: their notes play through their instrument.",
            "A layer clip inherits the effects of the source track and source clip it plays. They show read-only under **From source** at the start of its Clip section; edit them on the source.",
            "FX clips change the picture only. They have no sound of their own.",
            "Hiding a track hides its picture but never changes the audio.",
          ],
        },
        { type: "h3", text: "Gain is the volume control" },
        {
          type: "p",
          text: "A clip makes sound through a **Gain** device. Every new clip with sound gets one at 0 dB, so you rarely think about it, but a clip with no enabled Gain on its own stack or its track's stack is silent. Turning off a row's **fx** switch in the timeline bypasses its stacks, Gains included, so its clips go quiet and the chain shows a \"Track FX off\" banner with an **On** button.",
        },
        {
          type: "note",
          tone: "tip",
          text: "If the mix ever sounds out of date, right-click the **Audio** row (or use its refresh button) and choose **Recompute audio**.",
        },
        { type: "h3", text: "Preview matches export" },
        {
          type: "p",
          text: "Export renders the mix offline with the same processing the preview uses in real time, including the same limiter, so the two agree. Parameter moves ramp smoothly over 15 ms, Reverb and Delay tails ring past the end of a clip, and the Limiter's lookahead is compensated so sound stays in sync with picture. Only the preview volume slider and scrubbing are left out of the export.",
        },
      ],
    },
    {
      id: "devices",
      title: "Working with devices",
      blocks: [
        {
          type: "p",
          text: 'Click the **+** at the end of any stack ("Add device to this clip", "…this layer", "…this track" or "…Global") to open the Add menu. It\'s grouped into **MIDI**, **Video** and **Audio**, and each group has categories you hover to open. Every item shows a short description of what it does.',
        },
        {
          type: "figure",
          shot: "audio-add-menu",
          alt: "The Add menu open on a clip, with the Audio group's Dynamics category expanded.",
          caption:
            "The Add menu, with the **Dynamics** category open. Audio categories are Volume & Stereo, EQ & Filter, Dynamics, Modulation & Delay, Distortion and Utility.",
          width: 760,
        },
        {
          type: "table",
          compact: true,
          head: ["To", "Do this"],
          rows: [
            ["Bypass a device", "Click its power button."],
            ["Collapse it", "Click the chevron, or double-click its title."],
            [
              "Reorder",
              "Drag the title bar, or focus it and press [[Alt]] + [[←]] / [[→]].",
            ],
            [
              "Move to another stack",
              "Drag it there, or press [[Alt]] + [[Shift]] + [[←]] / [[→]]. The context menu's **Move** submenu has to Global, to Layer or Track, and to Clip.",
            ],
            [
              "Remove it",
              "Click its remove button, or press [[Delete]] with the title focused.",
            ],
            [
              "Copy or cut it",
              "Right-click the title for Cut, Copy and Duplicate, then right-click an empty part of a stack and choose **Paste**.",
            ],
            ["Reset a knob", "Double-click the knob or fader."],
            [
              "Type a value",
              "Double-click the value, or focus the knob and press [[Enter]].",
            ],
            [
              "Fine-tune",
              "Hold [[Shift]] while scrolling, or use the arrow keys, Page Up/Down and Home/End.",
            ],
          ],
        },
        {
          type: "p",
          text: "Right-clicking empty space in a stack also offers **Clear All**, which removes the Layer and Clip devices and keeps Global. A device placed on a stack it doesn't work on shows a **Not supported here** chip.",
        },
      ],
    },
    {
      id: "instruments",
      title: "Instruments and MIDI",
      blocks: [
        {
          type: "p",
          text: "MIDI clips play through instruments that live on the clip's own stack, under **MIDI** in the Add menu. Arpeggiators rework the notes first, in stack order. Then the **first enabled instrument** plays them, and any instruments after it stay silent. The sound then runs through the clip's audio effects. Create a MIDI clip by right-clicking a source track's lane and choosing **Add MIDI Clip**.",
        },
        {
          type: "figure",
          shot: "audio-drum-rack",
          alt: "The Drum Rack device with its TR-808 bank: a four by four grid of pads from Kick to Cowbell.",
          caption:
            "**Drum Rack**: 16 pads in a 4 × 4 grid, from pad 1 at the bottom left to pad 16 at the top right.",
        },
        { type: "h3", text: "Drum Rack" },
        {
          type: "list",
          items: [
            "Pick a bank from the **Bank** menu: **TR-808** (the default), **TR-909**, **CR-78** or **8-Bit**. Picking a bank resets every pad.",
            "Pads follow the General MIDI drum map: pad 1 is note 36 (C1), and pad N plays note 35 + N. The TR-808 runs Kick, Rimshot, Snare, Clap, Snare Snappy, Low Tom, Closed Hat, Low Conga, Maracas, Mid Tom, Open Hat, Mid Conga, High Tom, Cymbal, High Conga and Cowbell.",
            "Click a pad to audition it. Its **…** menu loads a file, restores the bank's own sample, or picks any audio in your media library. You can also drag media straight onto a pad.",
            "Every hit plays the whole sample at a level set by the note's velocity. Closed, pedal and open hats choke each other, like the real thing.",
          ],
        },
        { type: "h3", text: "Synth" },
        {
          type: "p",
          text: "An oscillator through a resonant High Cut filter, shaped by an ADSR envelope. The knobs are in two rows, **Tone** and **Env**.",
        },
        {
          type: "figure",
          shot: "audio-synth",
          alt: "The Synth device on the Bass clip, showing Wave, Octave, Detune, Cutoff and Resonance, then Attack, Decay, Sustain and Release.",
          width: 640,
        },
        {
          type: "table",
          compact: true,
          head: ["Control", "Range", "Default"],
          rows: [
            ["Wave", "Saw, Square, Tri, Sine", "Saw"],
            ["Octave", "−3 to +3", "0"],
            ["Detune", "−1200 to +1200 cents", "0"],
            ["Cutoff", "20 Hz – 20 kHz", "2.4 kHz"],
            ["Resonance", "0.1 – 30", "1.0"],
            ["Attack", "1 ms – 10 s", "5 ms"],
            ["Decay", "1 ms – 10 s", "150 ms"],
            ["Sustain", "0 – 100%", "60%"],
            ["Release", "1 ms – 10 s", "200 ms"],
          ],
        },
        { type: "h3", text: "Granular" },
        {
          type: "p",
          text: "Plays your notes as clouds of short grains of a built-in sound, which sits at middle C when unshifted. Grains are seeded, so a clip renders the same way every time.",
        },
        {
          type: "table",
          compact: true,
          head: ["Control", "Range", "Default"],
          rows: [
            ["Grain Size", "10 – 500 ms", "80 ms"],
            ["Density", "1 – 100 grains/s", "30/s"],
            ["Position", "0 – 100%", "30%"],
            ["Spray", "0 – 100%", "20%"],
            ["Transpose", "−24 to +24 semitones", "0"],
            ["Attack", "1 ms – 10 s", "20 ms"],
            ["Release", "1 ms – 10 s", "300 ms"],
            ["Cutoff", "20 Hz – 20 kHz", "6.0 kHz"],
            ["Resonance", "0.1 – 30", "1.0"],
          ],
        },
        { type: "h3", text: "Arpeggiator" },
        {
          type: "p",
          text: "Plays held chords one note at a time, locked to the beat. **Rate** is 1/4, 1/8, 1/16 (default) or 1/32. **Pattern** is Up, Down, Up-Down or Random. **Octaves** spans 1 to 4.",
        },
        { type: "h3", text: "Editing notes" },
        {
          type: "p",
          text: "Select a MIDI clip and its **Notes** piano roll opens in the FX panel, beside the clip's start, length and loop settings.",
        },
        {
          type: "figure",
          shot: "audio-piano-roll",
          alt: "The piano roll for the Drums clip, with rows of notes and a velocity lane underneath.",
        },
        {
          type: "list",
          items: [
            "Click empty grid to add a note. Drag a note to move it, or hold [[⌘/Ctrl]] while dragging to drop a copy. Drag an edge to change its length.",
            "Arrow keys nudge the selection, [[Delete]] removes it, and [[⌘/Ctrl]] + [[D]], [[X]], [[C]] and [[V]] duplicate, cut, copy and paste. Paste lands at the playhead.",
            "Click a note or a piano key to hear it through the clip's instrument. Right-click a note for more actions.",
            "Drag the stems in the velocity lane along the bottom to set how hard each note hits.",
          ],
        },
      ],
    },
    {
      id: "effects",
      title: "Audio effects",
      blocks: [
        {
          type: "p",
          text: "Twenty-two audio effects, grouped as they are in the Add menu. Ranges are minimum to maximum, and the default is what a new device starts at. Unless noted, every effect works on clips, layers or tracks, and Global.",
        },
        { type: "h3", text: "Volume & Stereo" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Gain**: sets the volume.",
              "Gain −68 to +10 dB (0 dB), with the bottom of the fader reading Mute · Mute switch (Off)",
            ],
            [
              "**Mono**: folds the sound to mono.",
              "Source Sum, Left or Right (Sum) · Amount 0–100% (100%)",
            ],
            [
              "**Stereo**: width and balance.",
              "Width 0–200% (100%), where 0% is mono and 200% doubles the sides · Pan L100 to R100 (C), equal-power",
            ],
            [
              "**Tremolo**: pulses the volume with an LFO.",
              "Sync (On) · Rate 0.1–20 Hz (5 Hz) or Note 1/32 to 1 bar, straight, dotted or triplet (1/8) · Depth 0–100% (50%) · Shape Sine, Triangle, Square",
            ],
            [
              "**Auto Pan**: moves the sound left and right.",
              "Sync (On) · Rate 0.05–20 Hz (1 Hz) or Note 1/32 to 4 bars (1 bar) · Depth 0–100% (100%) · Shape Sine, Triangle, Square",
            ],
          ],
        },
        { type: "h3", text: "EQ & Filter" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**EQ**: low shelf, mid peak and high shelf.",
              "Low Freq 20 Hz–1 kHz (100 Hz) · Low Gain ±15 dB (0) · Mid Freq 100 Hz–10 kHz (1 kHz) · Mid Gain ±15 dB (0) · Mid Q 0.3–10 (1.0) · High Freq 1–20 kHz (8 kHz) · High Gain ±15 dB (0)",
            ],
            [
              "**Low Cut**: removes lows below the cutoff.",
              "Frequency 20 Hz–20 kHz (80 Hz) · Resonance 0.1–18 (0.71) · Slope 12 or 24 dB/oct (12)",
            ],
            [
              "**High Cut**: removes highs above the cutoff.",
              "Frequency 20 Hz–20 kHz (8 kHz) · Resonance 0.1–18 (0.71) · Slope 12 or 24 dB/oct (12)",
            ],
          ],
        },
        {
          type: "figure",
          shot: "audio-eq",
          alt: "The EQ device with Low, Mid and High frequency and gain knobs.",
          width: 520,
        },
        { type: "h3", text: "Dynamics" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Compressor**: turns down what rises above the threshold.",
              "Threshold −60–0 dB (−18) · Ratio 1:1–20:1 (4:1) · Attack 0.1–100 ms (10) · Release 10–1000 ms (100) · Knee 0–30 dB (6) · Makeup 0–24 dB (0) · Mix 0–100% (100%) for parallel compression",
            ],
            [
              "**Limiter**: holds every peak under the ceiling.",
              "Ceiling −20–0 dB (−1) · Release 1–1000 ms (50) · Lookahead 0–10 ms (5) · Gain 0–24 dB (0)",
            ],
            [
              "**Noise Gate**: silences sound below a threshold.",
              "Threshold −80–0 dB (−50) · Attack 0.1–50 ms (1) · Hold 0–500 ms (20) · Release 5–1000 ms (100) · Range −80–0 dB (−80)",
            ],
            [
              "**De-ess**: tames harsh sibilance.",
              "Frequency 2–12 kHz (6 kHz) · Threshold −60–0 dB (−20) · Amount 0–24 dB (6) · Listen solos the detection band (Off)",
            ],
            [
              "**Transient Shaper**: shapes attack and sustain at any level.",
              "Attack ±100% (0) · Sustain ±100% (0) · Output −24 to +12 dB (0)",
            ],
          ],
        },
        {
          type: "figure",
          shot: "audio-compressor",
          alt: "The Compressor device with Threshold, Ratio, Attack, Release, Knee, Makeup and Mix knobs.",
          width: 640,
        },
        { type: "h3", text: "Modulation & Delay" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Chorus**: thickens with a swept short delay.",
              "Rate 0.05–5 Hz (0.8) · Depth 0–100% (50%) · Delay 5–30 ms (15) · Feedback 0–90% (0) · Spread 0–100% (50%) · Mix (50%)",
            ],
            [
              "**Phaser**: sweeping all-pass notches.",
              "Rate 0.05–10 Hz (0.5) · Depth (70%) · Stages 2, 4, 6, 8 or 12 (4) · Center 200 Hz–5 kHz (1 kHz) · Feedback 0–90% (30%) · Mix (50%)",
            ],
            [
              "**Delay**: fading echoes, on the beat if you like.",
              "Sync (On) · Time 1–2000 ms (375) or Note 1/32 to 1 bar (1/8 dotted) · Feedback 0–95% (35%) · Ping-pong (Off) · High cut 1–20 kHz (8 kHz) · Mix (30%)",
            ],
            [
              "**Reverb**: places the sound in a room or hall.",
              "Decay 0.2–10 s (2 s) · Pre-delay 0–200 ms (20) · Size (50%) · Damping 1–20 kHz (8 kHz) · Mix (25%)",
            ],
          ],
        },
        { type: "h3", text: "Distortion" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Saturation**: warm harmonic drive.",
              "Drive 0–36 dB (6) · Type Soft, Hard, Tape or Tube (Soft) · Tone 1–20 kHz (12 kHz) · Output −24 to +6 dB (0) · Mix (100%)",
            ],
            [
              "**Bitcrush**: lo-fi grit.",
              "Bits 1–16 (8) · Downsample 1×–64× (1×) · Mix (100%)",
            ],
          ],
        },
        { type: "h3", text: "Utility (clips only)" },
        {
          type: "table",
          head: ["Effect", "Controls (default)"],
          rows: [
            [
              "**Reverse**: plays the clip's audio backwards while its video plays forwards.",
              "No settings",
            ],
            [
              "**Re-Pitch**: shifts pitch, like tape or keeping time.",
              "Algorithm Tape, Transients or Formants (Tape) · Semitones ±12 (0) · Cents ±100 (0) · Transients or Formants 0–100% (100%), shown for that algorithm",
            ],
          ],
        },
      ],
    },
    {
      id: "modulation",
      title: "Modulating effects",
      blocks: [
        {
          type: "p",
          text: "Any audio effect except Reverse and Re-Pitch can move its own knobs. Click the modulation toggle in the device header to attach a **Modulation** section to its right edge, then pick a mode and which knobs to move from **Parameters**. Turning it off keeps your settings.",
        },
        {
          type: "figure",
          shot: "audio-modulation",
          alt: "The Compressor with its Modulation section attached, set to Transient mode.",
        },
        {
          type: "table",
          compact: true,
          head: ["Mode", "Controls"],
          rows: [
            [
              "Transient",
              "Listens for hits on the effect's own input. Timing Slow, Normal or Fast · Reactivity 0–100% · Amplitude −10× to 10× · Motion None, Bounce, Wobble or Single",
            ],
            [
              "LFO",
              "Runs on session time. Sync On or Off · Shape Sine, Triangle, Saw Up, Saw Down, Square or Random · Rate 4 bars to 1/32 with dotted and triplet values, or 0.05–20 Hz · Depth −10× to 10× (negative inverts) · Phase 0–360°",
            ],
          ],
        },
        {
          type: "p",
          text: "Each effect starts by moving its most musical knob: Frequency on the cuts, Threshold on the Compressor, Drive on Saturation, Mix on Delay and Reverb, Pan on Stereo, and so on. Swings are a share of the knob's travel, so frequency and time knobs swing musically.",
        },
        {
          type: "note",
          text: "Video effects have the same idea under the name **Animation**. See [Animation and modulation](../motion/).",
        },
      ],
    },
    {
      id: "metering",
      title: "Meters and analysis",
      blocks: [
        { type: "h3", text: "Level meters" },
        {
          type: "p",
          text: "The transport bar's meter reads the finished mix, after every Gain and the master limiter but before your preview volume. Bars show each channel's peak from −60 to +6 dB, a hold line marks the recent peak for 1.5 seconds, and the readout shows the RMS level (\"-inf dB\" in silence). A clip light latches whenever a channel goes over 0 dB; click it to clear.",
        },
        {
          type: "figure",
          shot: "audio-meter",
          alt: "The transport bar's stereo level meter, dB readout, mute button and preview volume slider during playback.",
          width: 520,
        },
        {
          type: "p",
          text: "Next to it, **Preview volume** and **Mute preview** only change what you hear while you work. They're never saved to the project or the export.",
        },
        { type: "h3", text: "The audio analysis pane" },
        {
          type: "p",
          text: "Click **Audio** in the preview's header to open a scrolling spectrogram of the master output, 20 Hz to 20 kHz on a log scale, beside a tall level meter. It scrolls while you play and holds its picture when you stop. On the Media tab it follows the clip playing there instead.",
        },
        {
          type: "figure",
          shot: "audio-analysis",
          alt: "The audio analysis pane under the preview, with a colorful spectrogram and a vertical level meter.",
          width: 560,
        },
        { type: "h3", text: "The Audio row" },
        {
          type: "p",
          text: "Docked at the bottom of the timeline, the **Audio** row draws the mix you'll hear: each sounding clip at its Gain, with Mute, FX switches and the Global Gain applied. MIDI clips are drawn from their notes rendered through their instrument. Its label tells you whether it's built from layers or source tracks. It doesn't reflect other effects, modulation or panning. Double-click its label to collapse it, or drag its edge to resize.",
        },
        {
          type: "figure",
          shot: "audio-row",
          alt: "The Audio row showing a waveform of the MIDI sample's mix.",
        },
      ],
    },
    {
      id: "export-audio",
      title: "Audio in exports",
      blocks: [
        {
          type: "list",
          items: [
            "MP4 exports carry AAC; WebM exports carry Opus.",
            "Bitrate is 128, 192 (default), 256 or 320 kbps.",
            "MP4 renders at 44.1 or 48 kHz (default 48). WebM is always 48 kHz.",
            "Exports are stereo. Mono media plays on both channels.",
          ],
        },
        {
          type: "p",
          text: "See [Export](../export/) for the rest of the export settings.",
        },
      ],
    },
  ],
};
