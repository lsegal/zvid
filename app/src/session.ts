export type LvpSession = {
  mainTracks?: Array<{ id: string; name: string; colorIndex?: number }>;
  tracks?: Array<{
    id: string;
    name: string;
    colorIndex?: number;
    recordings?: Array<{
      filename: string;
      frameStart?: number;
      numFrames?: number;
      frameRate?: number;
    }>;
  }>;
  clips?: Array<{
    id: string;
    trackId: string;
    name?: string;
    frameStart: number;
    frameCount: number;
    frameOffset?: number;
    clipStart?: number;
    filePath: string;
    warpMarkers?: Array<{
      id: string;
      clipId: string;
      secTime: number;
      beatTime: number;
    }>;
    frameHiddenLoopEnd?: number;
    captureOffset?: number;
    /** Seconds; the Layers app writes `"NaN"` for MIDI clips. */
    audioFileDuration?: number | "NaN";
  }>;
  selections?: Array<{
    id: number;
    trackId: string;
    mainTrackId: string;
    frameStart: number;
    frameEnd: number;
    selected?: boolean;
  }>;
  effects?: Array<{
    id: string;
    trackId: string;
    effectName: string;
    parameters?: Record<string, { floatValue?: number; stringValue?: string }>;
  }>;
  timeline?: {
    bpm?: number;
    fps?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    displaySeconds?: boolean;
    snapToBeat?: boolean;
    zoom?: number;
    projectDuration?: number;
  };
  playPosition?: number;
  playStartPosition?: number;
  audioFilename?: string;
  sessionFile?: string;
};

export type ServerMediaRef = {
  id: string;
  path: string;
  name: string;
  url: string;
  exists: boolean;
};

export type SessionOpenResponse = {
  sessionName: string;
  sessionPath?: string;
  session: LvpSession;
  mediaRefs: ServerMediaRef[];
};
