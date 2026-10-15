import type { Guide } from "./types";

export const ableton: Guide = {
  id: "ableton",
  title: "Ableton Live",
  accent: "blue",
  summary:
    "Film your performance while Live plays with the **ZVID Capture** plugin, then open the Live Set in zvid. Every take lands where it was played, already in time with the music.",
  sections: [
    {
      id: "overview",
      title: "How it fits together",
      blocks: [
        {
          type: "steps",
          items: [
            "Install **ZVID Capture** and add it to an audio track in Live.",
            "Arm it and play. Each pass from play to stop becomes a take, recorded from your camera in sync with Live's transport.",
            "Save the set, then open the `.als` in zvid with **File › Open › Session…**.",
            "Your tracks arrive as source tracks with every take in place. Arrange them on layers and export.",
          ],
        },
      ],
    },
    {
      id: "install",
      title: "Installing ZVID Capture",
      blocks: [
        {
          type: "table",
          compact: true,
          head: ["", "Requirement"],
          rows: [
            ["Live", "Ableton Live 12 or later"],
            [
              "macOS",
              "macOS 13 or later on Apple silicon, as VST3 and Audio Unit. Intel Macs aren't supported.",
            ],
            ["Windows", "Windows 10 or 11 on x64, as VST3"],
            [
              "Camera",
              "Anything your computer sees as a camera: built-in, USB, an iPhone through Continuity Camera, or a phone webcam app",
            ],
          ],
        },
        {
          type: "installer",
          items: [
            {
              platform: "macos",
              label: "macOS (Apple Silicon)",
              file: "zvid-capture-macos.pkg",
            },
            {
              platform: "windows",
              label: "Windows",
              file: "zvid-capture-windows-setup.exe",
            },
          ],
        },
        {
          type: "steps",
          items: [
            "Download and run the installer. On macOS it installs the VST3 and Audio Unit plug-ins into `/Library/Audio/Plug-Ins`; on Windows it installs the VST3 plug-in into `Common Files\\VST3`.",
            "In Live, open **Settings › Plug-Ins**, turn on **Use Audio Units** or **Use VST3 Plug-In System Folders**, then click **Rescan**.",
            "Drag **ZVID Capture** from Plug-Ins onto an audio track, pick your camera in the plug-in window and record.",
            "Optional: click **Install Live companion** in the plug-in window and choose **ZVID Capture** as a Control Surface, so Live's record buttons start capture and takes save beside your set. See [The Live companion](#companion).",
          ],
        },
        {
          type: "p",
          text: "The same downloads are in the app under **Help › Install Capture Plugin**. Each one is the latest build.",
        },
        {
          type: "note",
          text: "The first time, macOS asks whether Live can use the camera. On Windows, allow camera access under **Settings › Privacy & security › Camera**.",
        },
      ],
    },
    {
      id: "plugin",
      title: "The plugin window",
      blocks: [
        {
          type: "table",
          compact: true,
          head: ["Part", "What's there"],
          rows: [
            [
              "Header",
              "The status (**No camera**, **Ready to capture**, a running timer while capturing, or **Camera unavailable**) and the camera menu, which lists each device as Built-in, USB, Continuity or Virtual.",
            ],
            [
              "Preview",
              "A live view of the camera, or help if it's blocked, in use by another app or not connected (with **Refresh devices**).",
            ],
            [
              "Capture card",
              "**Record** and **Stop capturing**. With the Live companion connected, it follows Live's own Record button instead.",
            ],
            [
              "Takes",
              "Every take, newest first, with a thumbnail, play button, date, length and bar position, plus a button to show the file in Finder or File Explorer.",
            ],
            [
              "Footer",
              "The camera's resolution and frame rate, any dropped frames, **Install Live companion**, and the version.",
            ],
          ],
        },
        {
          type: "p",
          text: "A take whose file has been moved shows **File missing**. A capture made without playback, so it has no place on the timeline, shows **Not placed**.",
        },
      ],
    },
    {
      id: "takes",
      title: "Recording takes",
      blocks: [
        {
          type: "list",
          items: [
            "Click **Record** in the plugin before you start playback. Each play-to-stop pass in Live becomes a take. A loop wrap or a jump starts a new one.",
            "Takes stay within about one frame of Live's transport.",
            "Video is recorded as HEVC (AV1 if your hardware lacks HEVC) with the track's audio as AAC, using your graphics hardware. Files are written so a crash doesn't lose the take.",
          ],
        },
        { type: "h3", text: "Where takes are saved" },
        {
          type: "p",
          text: "With the Live companion running and the set saved, takes go to `Recorded/ZVID` inside the set's folder. Otherwise they go to `Documents/ZVID/Recorded`. If you **Save As** to a new folder, copy `Recorded/ZVID` along with it: **Collect All and Save** doesn't include it.",
        },
      ],
    },
    {
      id: "companion",
      title: "The Live companion",
      blocks: [
        {
          type: "p",
          text: "The companion is an optional control surface. With it, Live's own Arrangement or Session **Record** button starts and stops capture, and takes are saved beside your set.",
        },
        {
          type: "steps",
          items: [
            "Click **Install Live companion** in the plugin's footer.",
            "Restart Live.",
            "In **Settings › Link, Tempo & MIDI**, choose **ZVID Capture** in an empty Control Surface slot. Leave Input and Output set to None.",
          ],
        },
        {
          type: "note",
          text: "Saving takes beside the set needs Live 11.3.42 or later. On older versions takes go to Documents.",
        },
      ],
    },
    {
      id: "import",
      title: "Opening a Live Set",
      blocks: [
        {
          type: "p",
          text: "Choose **File › Open › Session…** and pick the `.als` file. zvid reads the arrangement and builds a session from it:",
        },
        {
          type: "list",
          items: [
            "Each arrangement clip on a track with ZVID Capture plays the take recorded under it. Where takes overlap, the one covering the most of the clip wins, then the newest.",
            "Audio clips whose sample is a video file play as video.",
            "In a set with no video, every audio and MIDI track comes in: audio clips play their samples, and MIDI clips become placeholders you can link video to.",
            "Warp markers and tempo changes, including automation, place every clip at the right moment. The session takes the set's tempo.",
            "Looped clips are unrolled into one clip per pass. Disabled clips are skipped.",
            "The loop brace, when it's on, sets the session length, and the playhead stays where you left it.",
            "Canvas size and frame rate come from your recordings.",
            "In the desktop app, a mixdown WAV beside the set with the same name becomes the session's main audio.",
          ],
        },
        {
          type: "p",
          text: "The arrangement starts empty with **Layer 1**, and the source tracks start locked, so you can arrange without nudging the takes. Commit windows with the number keys, as described in [Editing and the timeline](../editing/#arranging).",
        },
        { type: "h3", text: "What isn't imported" },
        {
          type: "list",
          items: [
            "Live's effects and devices.",
            "Track colors: zvid gives source tracks its own colors.",
            "The time signature: the session opens in 4/4. Set it from **Time Sig** in the toolbar.",
            "Session View clips. Only the Arrangement is read.",
          ],
        },
        { type: "h3", text: "Missing takes" },
        {
          type: "p",
          text: "The desktop app looks for takes next to the set, in its `Recorded` folders, and in Live's `Samples` folders. In the browser zvid can't read your disk, so takes open offline: choose **File › Locate Offline Media…** and pick the files or the folder. A notice after import lists what was brought in, what was skipped and why, and which files couldn't be found.",
        },
      ],
    },
  ],
};
