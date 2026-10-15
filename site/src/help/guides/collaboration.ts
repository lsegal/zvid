import type { Guide } from "./types";

export const collaboration: Guide = {
  id: "collaboration",
  title: "Collaboration and projects",
  accent: "orange",
  summary:
    "Share a session with a link and edit it together in real time, with media sent directly between you. Your own sessions autosave in the browser, carry their undo history, and pack into a single `.zvd` file when you want to move them.",
  sections: [
    {
      id: "sharing",
      title: "Sharing a session",
      blocks: [
        {
          type: "steps",
          items: [
            "Click **Share** in the top bar.",
            "Check the room name, then click **Start Sharing**. zvid creates a room and copies an invite link to your clipboard.",
            "Send the link. Anyone who opens it joins your session.",
            "Click **Stop Share** any time to disconnect everyone at once.",
          ],
        },
        {
          type: "figure",
          shot: "collab-share-dialog",
          alt: "The Share this session publicly? dialog with Room, Signal and Connection cards and a Start Sharing button.",
          width: 560,
        },
        {
          type: "list",
          items: [
            "While you're sharing, a link button next to **Stop Share** copies the invite again. If your browser blocks the clipboard, zvid shows the link selected so you can copy it yourself.",
            "Invites made on your own computer's development server only work on your computer or network. Share from the deployed app to invite others.",
            "**New Session** is disabled while you share, because starting over would wipe everyone's project.",
          ],
        },
        { type: "h3", text: "Joining" },
        {
          type: "p",
          text: "Open an invite link and zvid connects on its own. Or choose **File › Connect to Share**, paste the invite and click **Connect**. Your own session is saved first, and autosave pauses while you're in someone else's. Leave with **File › Disconnect from Share**.",
        },
      ],
    },
    {
      id: "together",
      title: "Working together",
      blocks: [
        {
          type: "list",
          items: [
            "**Every edit syncs**: clips, layers, effects, tempo, settings.",
            '**You see each other**: everyone gets a name like "Neon Fox" and a color, and their pointer shows on your screen with their name.',
            "**The host's project wins at the start**: a guest adopts the room's state when joining, so a slow connection can't overwrite the host's work. After that, edits flow both ways.",
            "**Playback is your own**: each person plays and scrubs independently. Someone else's edit stops your playback so you see the change.",
          ],
        },
        {
          type: "note",
          text: "Two tabs in the same browser sync with each other directly. To try sharing for real, use two browsers or two computers.",
        },
      ],
    },
    {
      id: "media-sync",
      title: "Media between collaborators",
      blocks: [
        {
          type: "p",
          text: 'Media isn\'t uploaded anywhere. When a guest is missing a file, it streams directly from a collaborator who has it, peer to peer. Files near the playhead and on screen come first. While a file is on its way, its clips shimmer and the ruler reads "Syncing N of M media files… P%".',
        },
        {
          type: "p",
          text: "Open **File › Media Sync Status…** (or click that ruler label) to see every file: where it's used, who it's coming from, and its progress. Each shows **Receiving**, **Queued**, **Ready**, **Offline** or **Unavailable**. **Retry** asks again for a file no one could send, and **Locate on disk…** links your own copy instead.",
        },
      ],
    },
    {
      id: "connection",
      title: "Connection status",
      blocks: [
        {
          type: "p",
          text: "The pill next to **Share** tells you where you stand. Click it for **Connection diagnostics**: whether the signaling server is reachable, peers found and connected, whether the project has been published or received, whether a relay is available, and the last error.",
        },
        {
          type: "table",
          compact: true,
          head: ["Status", "What it means"],
          rows: [
            [
              "Sharing, waiting for peer",
              "You're hosting and no one has joined yet.",
            ],
            ["N peers connected", "Everything's working."],
            [
              "Waiting for host…",
              "You've joined, but the host isn't connected yet.",
            ],
            [
              "Host not found",
              "Check the invite, and that the host is still sharing.",
            ],
            [
              "Can't reach peers, check network",
              "A firewall is blocking direct connections. The deployed app relays traffic when needed.",
            ],
            [
              "Can't reach the signaling server",
              "zvid can't find other people. Check your internet connection.",
            ],
          ],
        },
        {
          type: "p",
          text: "zvid's signaling server only introduces peers to each other. It never sees your project or media.",
        },
      ],
    },
    {
      id: "sessions",
      title: "Sessions",
      blocks: [
        {
          type: "p",
          text: "Your sessions live in this browser. Click **Sessions** in the toolbar to see them, newest first, with how many clips each has and when you last changed it. Search by name, click one to open it, and right-click for **Open**, **Rename…** ([[F2]]), **Duplicate** and **Delete…**. Deleting a session keeps its media in the cache.",
        },
        {
          type: "figure",
          shot: "collab-sessions",
          alt: "The Sessions drawer listing saved sessions with clip counts and modified times, the open one marked Open.",
          width: 560,
        },
        { type: "h3", text: "Saving and autosave" },
        {
          type: "list",
          items: [
            'Your work autosaves about half a second after each change, and again when a drag ends. Reload and you\'re right where you were, with "Restored …" in the status bar.',
            "**File › Save** ([[⌘/Ctrl]] + [[S]]) adds the session to the Sessions list.",
            "Undo history is saved too, up to 100 steps, so you can undo after a reload.",
          ],
        },
        { type: "h3", text: "One tab at a time" },
        {
          type: "p",
          text: "Only one tab saves a session. Open it in a second tab and zvid asks whether to **Open read-only** or **Take over**. A read-only tab shows a banner and doesn't save; click **Take over** whenever you want to edit there.",
        },
      ],
    },
    {
      id: "files",
      title: "Project files",
      blocks: [
        {
          type: "p",
          text: "To move a session to another computer or send it to someone, choose **File › Export › Project…**. It saves a `.zvd` archive: the session's `project.json`, plus its media if you tick **Include media files**. Open it anywhere with **File › Open › Session…**, which also opens `.json` sessions and Ableton Live Sets.",
        },
        {
          type: "figure",
          shot: "collab-export-project",
          alt: "The Export Project dialog with an Include media files checkbox.",
          width: 480,
        },
        {
          type: "p",
          text: "Media that isn't in the archive opens offline. Use **File › Locate Offline Media…** to point zvid at the files: pick them one at a time, several at once, or a whole folder. zvid matches them by name.",
        },
      ],
    },
    {
      id: "media",
      title: "The Media drawer and storage",
      blocks: [
        {
          type: "p",
          text: "Click **Media** in the toolbar for every file in the session, as **Icons** or a **List** with name, kind and duration. Search, change the thumbnail size, double-click to preview a file in the Media tab, or drag it onto a source track. **Details** shows a file's size, container, video and audio codecs, duration and bitrate.",
        },
        {
          type: "figure",
          shot: "collab-media",
          alt: "The Media drawer in list view with a file selected and its details pane open.",
          width: 640,
        },
        { type: "h3", text: "Media Storage" },
        {
          type: "p",
          text: "zvid keeps a copy of your media in the browser so sessions reopen without relinking. **File › Media Storage…** shows how much space it's using, whether the browser treats it as persistent, and which sessions own what. Clear media for other sessions, or everything. When space runs low, zvid clears the files you used least recently first, never ones the open session needs.",
        },
        {
          type: "figure",
          shot: "collab-media-storage",
          alt: "The Media Storage dialog showing storage type, space used, cached media count, a usage bar and a list per session.",
          width: 520,
        },
      ],
    },
    {
      id: "desktop",
      title: "The desktop app",
      blocks: [
        {
          type: "p",
          text: "Everything works in the browser, but **Help › Download Desktop App** gets you zvid for Windows and Apple silicon Macs. It adds:",
        },
        {
          type: "list",
          items: [
            "Native open and save dialogs, and sessions and Live Sets opened by path, so media on disk links up by itself.",
            "**Reveal file** after an export, and a warning before closing the window mid-export.",
            "**Prompt zvid**: tell zvid what to do in plain words and watch it run the commands, using your ChatGPT plan.",
            "**Help › Check for Updates…**",
          ],
        },
      ],
    },
  ],
};
