import type { Guide } from "./types";

export const exportGuide: Guide = {
  id: "export",
  title: "Export",
  accent: "lime",
  summary:
    "Render the finished video on your own machine with hardware encoding. No upload, no queue, and the audio matches what you heard in the preview.",
  sections: [
    {
      id: "dialog",
      title: "The Export dialog",
      blocks: [
        {
          type: "p",
          text: "Click **Export** in the top bar, or choose **File › Export › Video…**. The dialog opens with a live preview, a range strip and your output settings, all filled in from Session Settings. Changing them here affects only this export.",
        },
        {
          type: "figure",
          shot: "export-dialog",
          alt: "The Export dialog: a preview with its own transport, a range strip with In and Out markers over thumbnails and a waveform, and Output settings with resolution, frame rate, codec, quality, audio and file name.",
        },
        {
          type: "p",
          text: "A dot marks every setting you've changed from Session Settings, and **Reset to session settings** puts them back. Reopen Export for the same session and your last choices are still there.",
        },
      ],
    },
    {
      id: "range",
      title: "Choosing the range",
      blocks: [
        {
          type: "list",
          items: [
            "Drag the **In** and **Out** markers on the range strip. They snap to beats; hold [[Shift]] to snap to frames instead.",
            "Or type them: `mm:ss:ff`, `hh:mm:ss:ff`, `ss:ff` or plain seconds. **Reset range** goes back to the default.",
            "Press [[I]] and [[O]] to set them at the playhead, [[Space]] to play, and [[Enter]] to export.",
            "The transport steps by frames, jumps to In and Out, and can loop the range.",
            "By default the range runs from the first clip to the session length, or the end of the last clip.",
          ],
        },
      ],
    },
    {
      id: "output",
      title: "Output settings",
      blocks: [
        {
          type: "table",
          compact: true,
          head: ["Setting", "Options"],
          rows: [
            [
              "Resolution",
              "1080p 16:9, 1080 × 1920 9:16, 1080 × 1080 1:1, 4K 16:9, 720p 16:9, or a custom width × height",
            ],
            ["Frame rate", "23.976, 24, 25, 29.97, 30, 50, 59.94 or 60 fps"],
            [
              "Video codec",
              "**Auto** (HEVC, then AV1, then H.264, whichever your device can encode), H.264, HEVC, AV1, VP8 or VP9. Codecs your device can't encode are marked unsupported.",
            ],
            [
              "Quality",
              "Low, Medium, High or Custom. High is 12 Mbps at 1080p 30 fps and scales with size and frame rate; Medium is 60% of that and Low 35%. Custom takes a bitrate in Mbps.",
            ],
            ["Audio", "128, 192, 256 or 320 kbps, at 44.1 or 48 kHz"],
            [
              "File name",
              "The session name, with the right extension for the codec",
            ],
          ],
        },
        {
          type: "table",
          compact: true,
          head: ["Codec", "File"],
          rows: [
            [
              "Auto, H.264, HEVC, AV1",
              "MP4 with AAC audio, plus a cover thumbnail from about one second in",
            ],
            ["VP8, VP9", "WebM with Opus audio at 48 kHz"],
          ],
        },
        {
          type: "p",
          text: "Under the settings, zvid estimates the file size and shows the duration and frame count.",
        },
      ],
    },
    {
      id: "rendering",
      title: "While it renders",
      blocks: [
        {
          type: "p",
          text: "Click **Export**. In the browser you choose where to save first (or the file downloads, if your browser can't ask). The dialog then shows each step (preparing audio, rendering frames, writing the file) with a progress bar and time left.",
        },
        {
          type: "list",
          items: [
            "**Run in background** hides the dialog and the export keeps going. So does pressing [[Esc]] or clicking outside. The status bar shows the progress, and a notice with **View** appears when it's done.",
            "**Cancel export** asks before stopping.",
            "zvid exports a snapshot of the session from when you started, so you can keep editing. Changes made during the export aren't in the file.",
            "One export runs at a time. In the desktop app, **Reveal file** shows the finished video in your file manager.",
          ],
        },
      ],
    },
    {
      id: "whats-rendered",
      title: "What gets rendered",
      blocks: [
        {
          type: "list",
          items: [
            "**Picture**: the layers with all their effects. If there are no layer clips yet, the source tracks render as layers.",
            "**Sound**: the full audio mix over the range, in stereo, through the same processing as the preview. See [Audio and mixing](../audio/#signal-flow).",
            "Preview volume and mute never affect the export.",
          ],
        },
        {
          type: "note",
          text: "MP4 export needs an H.264, HEVC or AV1 encoder and an AAC encoder in your browser. If one's missing, choose VP8 or VP9 for WebM, or try a current version of Chrome or Edge.",
        },
      ],
    },
    {
      id: "project",
      title: "Exporting the project",
      blocks: [
        {
          type: "p",
          text: "**File › Export › Project…** saves the session itself as a `.zvd` archive, optionally with its media, to open on another computer. See [Project files](../collaboration/#files).",
        },
      ],
    },
  ],
};
