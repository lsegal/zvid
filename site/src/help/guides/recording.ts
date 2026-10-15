import type { Guide } from "./types";

export const recording: Guide = {
  id: "recording",
  title: "Recording on the timeline",
  accent: "pink",
  summary:
    "Record camera and microphone takes straight onto source tracks, in time with your session. Arm as many tracks as you have inputs and they all record in one pass.",
  sections: [
    {
      id: "quick",
      title: "Record a take",
      blocks: [
        { type: "video", id: "record-take" },
        {
          type: "steps",
          items: [
            "Click **+ Track** under Source Tracks to add an empty track, or use one you already have.",
            "Click the track's red record button to arm it.",
            "Click **Record armed tracks** in the transport. Playback starts at the playhead and the take grows on the timeline.",
            "Press **Record** again to stop recording and keep playing, or stop playback to end both.",
          ],
        },
        {
          type: "note",
          text: "Your browser asks for camera and microphone access the first time you open the Record tab or record. If you said no, allow it in the site settings and pick the input again.",
        },
      ],
    },
    {
      id: "inputs",
      title: "Choosing inputs",
      blocks: [
        { type: "h3", text: "The Record tab" },
        {
          type: "p",
          text: "Open **Record** in the toolbar (next to Sessions and Media) to set your default inputs. **Video** and **Audio** each offer **System default**, **None**, or a specific device, with a live camera preview and a level meter for the microphone. These choices belong to this computer, not to the session, so collaborators keep their own.",
        },
        {
          type: "figure",
          shot: "recording-record-tab",
          alt: "The Record tab with Video and Audio input menus, a live camera preview and a microphone level meter.",
          width: 520,
        },
        { type: "h3", text: "Per-track inputs" },
        {
          type: "p",
          text: "Select a source track and its **Record** device leads the FX panel, with its own arm button and **Video** and **Audio** menus. They start on **Default**, and picking a device or **None** overrides the default for that track only. That's how you record two cameras, or a camera on one track and a microphone on another, in the same pass. The device expands while the track is armed.",
        },
        {
          type: "figure",
          shot: "recording-device",
          alt: "An armed source track with its Record device open, showing camera and microphone menus, a camera preview and a level meter.",
        },
      ],
    },
    {
      id: "transport",
      title: "How Record behaves",
      blocks: [
        {
          type: "table",
          compact: true,
          head: ["When you", "zvid"],
          rows: [
            [
              "Press Record while stopped",
              "Starts playback at the playhead and records every armed track.",
            ],
            [
              "Press Record while playing",
              "Joins playback where it is and starts recording.",
            ],
            [
              "Press Record while recording",
              "Stops recording and keeps playing.",
            ],
            ["Stop playback", "Ends playback and recording together."],
          ],
        },
        {
          type: "list",
          items: [
            "Record is disabled until at least one track is armed.",
            "Recording ignores the loop and keeps going until you stop. The timeline grows a bar at a time to make room.",
            "Arming is local to your browser. It isn't saved in the session or shared with collaborators, and deleting a track disarms it.",
          ],
        },
      ],
    },
    {
      id: "takes",
      title: "Takes",
      blocks: [
        {
          type: "p",
          text: "While you record, each armed track grows a clip from the playhead with a filmstrip from the camera, a waveform from the microphone and a red **REC** badge. The status light turns red and the Record button stays lit.",
        },
        {
          type: "figure",
          shot: "recording-live-take",
          alt: "A take recording on a source track: a red REC badge, a growing green filmstrip and waveform, and the red Record button lit in the transport.",
          caption:
            "A take in progress, recorded here from the browser's test camera.",
        },
        { type: "h3", text: "When you stop" },
        {
          type: "list",
          items: [
            "Each take is added to your media and placed on its track where recording started, replacing anything it overlaps, even on locked tracks.",
            'Takes are named after the track and the time, like "Source Track 1 2026-10-14 23.37.12".',
            "Files are recorded by your browser, usually as WebM with VP9 or VP8 video and Opus audio, then tidied up so they seek properly. No re-encoding happens.",
            "Everything from one pass is a single undo step, **Record**.",
            'The status bar shows "Saving N recordings…", then "Recorded N clips."',
          ],
        },
      ],
    },
    {
      id: "troubleshooting",
      title: "If something goes wrong",
      blocks: [
        {
          type: "table",
          compact: true,
          head: ["Message", "What to do"],
          rows: [
            [
              '"…has no camera or microphone selected."',
              "Pick a Video or Audio input on the Record tab or the track's Record device.",
            ],
            [
              '"Couldn\'t record …: access to the camera or microphone was denied"',
              "Allow camera and microphone access in your browser's site settings.",
            ],
            [
              '"…isn\'t connected" or "…is in use by another app"',
              "Reconnect the device, or close the other app using it.",
            ],
            [
              '"This browser can\'t record from cameras or microphones."',
              "Use a current Chrome, Edge, Firefox or Safari.",
            ],
            [
              '"Stopped recording …"',
              "One device failed. The other armed tracks keep recording.",
            ],
          ],
        },
        {
          type: "p",
          text: "A tab that's open read-only (because the session is open in another tab) won't record. Take over the session first. Want to film while Ableton Live plays instead? See [Ableton Live](../ableton/).",
        },
      ],
    },
  ],
};
