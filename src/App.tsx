import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  BufferTarget,
  CanvasSource,
  CanvasSink,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
  canEncodeVideo,
} from 'mediabunny'
import { CompositionPlayer, type CompositionPlayerHandle } from './CompositionPlayer'
import './App.css'

const FFMPEG_CORE_URL = '/ffmpeg/ffmpeg-core.js'
const FFMPEG_WASM_URL = '/ffmpeg/ffmpeg-core.wasm'

type MediaKind = 'video' | 'audio'
type TimelineMode = 'musical' | 'timecode'
type SnapMode = 'bar' | 'beat' | 'half' | 'quarter'

type TimeSignature = {
  id: string
  numerator: number
  denominator: number
}

type Palette = {
  color: string
  accent: string
}

type MediaItem = {
  id: string
  name: string
  kind: MediaKind
  durationSeconds: number
  width?: number
  height?: number
  fps?: number
  sampleRate?: number
  channels?: number
  hasAudio: boolean
  hasVideo: boolean
  color: string
  accent: string
  waveform: number[]
  previewUrl: string
  thumbnailUrl?: string
  sourcePath?: string
}

type ServerMediaRef = {
  id: string
  path: string
  name: string
  url: string
  exists: boolean
}

type SessionOpenResponse = {
  sessionName: string
  sessionPath?: string
  session: LvpSession
  mediaRefs: ServerMediaRef[]
}

type Lane = {
  id: string
  name: string
  colorIndex: number
}

type SourceTrack = {
  id: string
  name: string
  colorIndex: number
  recordingPaths: string[]
}

type ArrangementClip = {
  id: string
  sourceTrackId: string
  laneId: string
  label: string
  mediaPath: string
  mediaId?: string
  startQ: number
  durationSeconds: number
  trimStartSeconds: number
  tint: string
  accent: string
  selected?: boolean
}

type EffectParameter = {
  key: string
  value: string
  numericValue?: number
}

type SessionEffect = {
  id: string
  trackId: string
  effectName: string
  parameters: EffectParameter[]
}

type FxParameter = {
  label: string
  value: number
  display: string
}

type FxDevice = {
  id: string
  name: string
  subtitle: string
  accent: string
  parameters: FxParameter[]
}

type DragState = {
  clipId: string
  pointerStart: number
  originQ: number
}

type TimelineDragState = {
  pointerId: number
  pointerStartX: number
  pointerStartY: number
  originPlayheadQ: number
  originZoom: number
}

type ExportState = {
  phase: 'idle' | 'preparing' | 'decoding-audio' | 'rendering' | 'loading-ffmpeg' | 'muxing'
  progress: number | null
  detail: string
}

type LvpSession = {
  mainTracks?: Array<{ id: string; name: string; colorIndex?: number }>
  tracks?: Array<{
    id: string
    name: string
    colorIndex?: number
    recordings?: Array<{ filename: string }>
  }>
  clips?: Array<{
    id: string
    trackId: string
    name?: string
    frameStart: number
    frameCount: number
    frameOffset?: number
    clipStart?: number
    filePath: string
  }>
  selections?: Array<{
    id: number
    trackId: string
    mainTrackId: string
    frameStart: number
    frameEnd: number
    selected?: boolean
  }>
  effects?: Array<{
    id: string
    trackId: string
    effectName: string
    parameters?: Record<string, { floatValue?: number; stringValue?: string }>
  }>
  timeline?: {
    canvasWidth?: number
    canvasHeight?: number
    zoom?: number
    bpm?: number
    displaySeconds?: boolean
    snapToBeat?: boolean
    fps?: number
    projectDuration?: number
  }
  audioFilename?: string
  sessionFile?: string
  playPosition?: number
  playStartPosition?: number
}

const LABEL_WIDTH = 240
const BASE_QUARTER_PX = 28
const ZOOM_MIN = 0.65
const ZOOM_MAX = 1.8
const TIMELINE_DRAG_ZOOM_SPEED = 0.004
const TIMELINE_DRAG_ZOOM_THRESHOLD_PX = 25
const TIMELINE_SCRUB_AUDIO_TAIL_MS = 50
const SIGNATURES: TimeSignature[] = [
  { id: '4/4', numerator: 4, denominator: 4 },
  { id: '3/4', numerator: 3, denominator: 4 },
  { id: '5/4', numerator: 5, denominator: 4 },
  { id: '6/8', numerator: 6, denominator: 8 },
  { id: '7/8', numerator: 7, denominator: 8 },
]
const SNAP_OPTIONS: { id: SnapMode; label: string }[] = [
  { id: 'bar', label: 'Bar' },
  { id: 'beat', label: 'Beat' },
  { id: 'half', label: '1/2' },
  { id: 'quarter', label: '1/4' },
]
const DEFAULT_LANES: Lane[] = [
  { id: '1', name: 'Layer 1', colorIndex: -1 },
  { id: '5', name: 'Layer 2', colorIndex: -1 },
  { id: '6', name: 'Layer 3', colorIndex: -1 },
]
const PALETTE: Palette[] = [
  { color: '#3d4052', accent: '#7ca1ff' },
  { color: '#444351', accent: '#ff6f9d' },
  { color: '#393d4d', accent: '#7ee0a4' },
  { color: '#474150', accent: '#f6b73c' },
  { color: '#434a58', accent: '#c38fff' },
]
const FALLBACK_VIDEO_FX: FxDevice[] = [
  {
    id: 'layout',
    name: 'FX: Layout',
    subtitle: 'Center / anchor / crop',
    accent: '#f6b73c',
    parameters: [
      { label: 'Position', value: 0.52, display: 'Center' },
      { label: 'Scale', value: 0.68, display: '68%' },
      { label: 'Parallax', value: 0.18, display: '18%' },
    ],
  },
  {
    id: 'beat-warp',
    name: 'Beat Warp',
    subtitle: 'Tempo-synced stretch markers',
    accent: '#ff6f9d',
    parameters: [
      { label: 'Grid', value: 0.5, display: '1/8' },
      { label: 'Swing', value: 0.21, display: '21%' },
      { label: 'Tension', value: 0.37, display: '37%' },
    ],
  },
]
const FALLBACK_AUDIO_FX: FxDevice[] = [
  {
    id: 'transient',
    name: 'Transient Focus',
    subtitle: 'Clip attack / sustain shaping',
    accent: '#f6b73c',
    parameters: [
      { label: 'Attack', value: 0.73, display: '+7.3 dB' },
      { label: 'Sustain', value: 0.28, display: '-2.8 dB' },
      { label: 'Mix', value: 0.84, display: '84%' },
    ],
  },
  {
    id: 'duck',
    name: 'Duck Compressor',
    subtitle: 'Sidechain against master pulse',
    accent: '#7ca1ff',
    parameters: [
      { label: 'Depth', value: 0.58, display: '58%' },
      { label: 'Release', value: 0.42, display: '240 ms' },
      { label: 'Lookahead', value: 0.14, display: '14 ms' },
    ],
  },
]
function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm
}

function secondsToQuarters(seconds: number, bpm: number) {
  return (seconds * bpm) / 60
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  return `${minutes}:${remainderSeconds.toString().padStart(2, '0')}.${tenths}`
}

function formatTimecode(seconds: number, fps = 30) {
  const minutes = Math.floor(seconds / 60)
  const remainderSeconds = Math.floor(seconds % 60)
  const frames = Math.floor(((seconds % 1) + Number.EPSILON) * fps)
  return `${minutes.toString().padStart(2, '0')}:${remainderSeconds
    .toString()
    .padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
}

function formatMusicalPosition(quarters: number, signature: TimeSignature) {
  const beatUnit = 4 / signature.denominator
  const barLength = signature.numerator * beatUnit
  const safeQuarter = Math.max(0, quarters)
  const bar = Math.floor(safeQuarter / barLength)
  const barOffset = safeQuarter - bar * barLength
  const beat = Math.floor(barOffset / beatUnit)
  const subdivision = Math.floor((barOffset - beat * beatUnit) / (beatUnit / 4))
  return `${bar + 1}.${beat + 1}.${subdivision + 1}`
}

function getSnapUnit(mode: SnapMode, signature: TimeSignature) {
  const beatUnit = 4 / signature.denominator
  const barLength = signature.numerator * beatUnit
  switch (mode) {
    case 'bar':
      return barLength
    case 'beat':
      return beatUnit
    case 'half':
      return beatUnit / 2
    case 'quarter':
      return beatUnit / 4
    default:
      return beatUnit
  }
}

function buildProjectWaveform(clips: ArrangementClip[], totalQuarters: number, bpm: number, points: number) {
  return Array.from({ length: points }, (_, index) => {
    const quarter = (index / Math.max(1, points - 1)) * totalQuarters
    const amplitude = clips.reduce((sum, clip) => {
      const start = clip.startQ
      const end = start + secondsToQuarters(clip.durationSeconds, bpm)
      if (quarter < start || quarter > end) {
        return sum
      }

      const phase = (quarter - start) / Math.max(end - start, 0.25)
      return sum + Math.abs(Math.sin(phase * Math.PI * 4)) * 0.35
    }, 0)

    return Math.min(1, 0.08 + amplitude)
  })
}

function getSwatch(colorIndex: number) {
  return PALETTE[Math.abs(colorIndex) % PALETTE.length] ?? PALETTE[0]
}

function buildFallbackWaveform(seed: string, points = 96) {
  let state = Array.from(seed).reduce(
    (total, character, index) => total + character.charCodeAt(0) * (index + 17),
    97,
  )
  return Array.from({ length: points }, (_, index) => {
    state = (state * 48271) % 2147483647
    const phase = state / 2147483647
    return Math.max(
      0.08,
      Math.min(1, Math.abs(Math.sin(index * 0.31 + phase * 5.2) * 0.72) + phase * 0.18),
    )
  })
}

function basename(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] ?? path
}

function normalizeMediaPath(value: string) {
  return value.replaceAll('/', '\\').toLowerCase()
}

function inferMediaKind(name: string): MediaKind {
  const extension = name.slice(Math.max(0, name.lastIndexOf('.'))).toLowerCase()
  switch (extension) {
    case '.wav':
    case '.mp3':
    case '.m4a':
    case '.flac':
    case '.aif':
    case '.aiff':
      return 'audio'
    default:
      return 'video'
  }
}

function logClient(event: string, payload?: unknown) {
  if (payload === undefined) {
    console.info(`[zvid] ${event}`)
    return
  }

  console.info(`[zvid] ${event}`, payload)
}

function createMediaId(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function sanitizeFilenameSegment(value: string) {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').trim()
  return sanitized || 'zvid-session'
}

type SaveFilePickerHandle = {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
  }>
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
  }) => Promise<SaveFilePickerHandle>
}

type SaveTarget =
  | {
      kind: 'picker'
      filename: string
      handle: SaveFilePickerHandle
    }
  | {
      kind: 'download'
      filename: string
    }

async function prepareSaveTarget(filename: string): Promise<SaveTarget> {
  const pickerWindow = window as SaveFilePickerWindow
  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: 'MP4 video',
          accept: {
            'video/mp4': ['.mp4'],
          },
        },
      ],
    })
    return {
      kind: 'picker',
      filename,
      handle,
    }
  }

  return {
    kind: 'download',
    filename,
  }
}

async function saveBlob(blob: Blob, target: SaveTarget) {
  if (target.kind === 'picker') {
    const writable = await target.handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return 'picker'
  }

  const downloadUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = target.filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0)
  return 'download'
}

function blobToUint8Array(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
}

function toArrayBuffer(data: Uint8Array | string) {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer
  }

  const normalized = new Uint8Array(data.byteLength)
  normalized.set(data)
  return normalized.buffer
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

async function canvasToObjectUrl(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
    return URL.createObjectURL(blob)
  }

  const element = canvas as HTMLCanvasElement
  const blob = await new Promise<Blob>((resolve, reject) => {
    element.toBlob((result) => {
      if (!result) {
        reject(new Error('Failed to create thumbnail blob'))
        return
      }
      resolve(result)
    }, 'image/jpeg', 0.82)
  })

  return URL.createObjectURL(blob)
}

async function sampleWaveform(seed: string, input: Input, points = 96) {
  const audioTrack = await input.getPrimaryAudioTrack()
  if (!audioTrack) {
    return buildFallbackWaveform(seed, points)
  }

  const duration = Math.max(0.01, await input.computeDuration())
  const sink = new AudioBufferSink(audioTrack)
  const timestamps = Array.from({ length: points }, (_, index) =>
    duration * (index / Math.max(1, points - 1)),
  )
  const waveform: number[] = []

  for await (const wrapped of sink.buffersAtTimestamps(timestamps)) {
    if (!wrapped) {
      waveform.push(0)
      continue
    }

    const channel = wrapped.buffer.getChannelData(0)
    let peak = 0
    for (let index = 0; index < channel.length; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0))
    }

    waveform.push(Math.min(1, peak))
  }

  return waveform.some((value) => value > 0.001) ? waveform : buildFallbackWaveform(seed, points)
}

function concatAudioBuffers(buffers: AudioBuffer[]) {
  if (!buffers.length) {
    return null
  }

  const channelCount = Math.max(...buffers.map((buffer) => buffer.numberOfChannels))
  const sampleRate = buffers[0].sampleRate
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const context = new OfflineAudioContext(channelCount, Math.max(1, totalLength), sampleRate)
  const combined = context.createBuffer(channelCount, Math.max(1, totalLength), sampleRate)
  let offset = 0

  for (const buffer of buffers) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sourceChannel = Math.min(channelIndex, buffer.numberOfChannels - 1)
      combined.getChannelData(channelIndex).set(buffer.getChannelData(sourceChannel), offset)
    }

    offset += buffer.length
  }

  return combined
}

function encodeAudioBufferAsWav(audioBuffer: AudioBuffer) {
  const channelCount = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const sampleCount = audioBuffer.length
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = sampleCount * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  let offset = 0

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index))
      offset += 1
    }
  }

  writeString('RIFF')
  view.setUint32(offset, 36 + dataSize, true)
  offset += 4
  writeString('WAVE')
  writeString('fmt ')
  view.setUint32(offset, 16, true)
  offset += 4
  view.setUint16(offset, 1, true)
  offset += 2
  view.setUint16(offset, channelCount, true)
  offset += 2
  view.setUint32(offset, sampleRate, true)
  offset += 4
  view.setUint32(offset, byteRate, true)
  offset += 4
  view.setUint16(offset, blockAlign, true)
  offset += 2
  view.setUint16(offset, bytesPerSample * 8, true)
  offset += 2
  writeString('data')
  view.setUint32(offset, dataSize, true)
  offset += 4

  const channels = Array.from({ length: channelCount }, (_, index) => audioBuffer.getChannelData(index))
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = channels[channelIndex]?.[sampleIndex] ?? 0
      const clamped = Math.max(-1, Math.min(1, sample))
      const encoded = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      view.setInt16(offset, Math.round(encoded), true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}

async function decodeAudioBufferFromUrl(
  url: string,
  durationSeconds: number,
  onProgress?: (progress: number, detail: string) => void,
) {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(url),
  })

  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) {
      return null
    }

    const sink = new AudioBufferSink(audioTrack)
    const decodedBuffers: AudioBuffer[] = []
    let decodedChunks = 0

    for await (const wrapped of sink.buffers(0, durationSeconds > 0 ? durationSeconds : undefined)) {
      decodedBuffers.push(wrapped.buffer)
      decodedChunks += 1

      if (onProgress) {
        const completion = Math.max(
          0,
          Math.min(
            100,
            Math.round((((wrapped.timestamp ?? 0) + (wrapped.duration ?? 0)) / Math.max(0.01, durationSeconds)) * 100),
          ),
        )
        onProgress(completion, `Decoding master audio for export (${completion}%)...`)
      }

      if (decodedChunks % 8 === 0) {
        await yieldToBrowser()
      }
    }

    return concatAudioBuffers(decodedBuffers)
  } finally {
    input.dispose()
  }
}

async function analyzeInputMedia(
  input: Input,
  options: {
    id: string
    name: string
    previewUrl: string
    palette: Palette
    sourcePath?: string
  },
): Promise<MediaItem> {
  try {
    const durationSeconds = await input.computeDuration()
    const videoTrack = await input.getPrimaryVideoTrack()
    const audioTrack = await input.getPrimaryAudioTrack()

    let thumbnailUrl: string | undefined
    let fps: number | undefined

    if (videoTrack) {
      const sink = new CanvasSink(videoTrack, {
        width: 240,
        height: 420,
        fit: 'cover',
        poolSize: 1,
      })
      const timestamp = Math.min(
        Math.max(durationSeconds * 0.18, 0.1),
        Math.max(durationSeconds - 0.05, 0.1),
      )
      const wrappedCanvas = await sink.getCanvas(timestamp)
      if (wrappedCanvas) {
        thumbnailUrl = await canvasToObjectUrl(wrappedCanvas.canvas)
      }

      fps = (await videoTrack.computePacketStats(240)).averagePacketRate
    }

    const waveform = await sampleWaveform(options.name, input)

    return {
      id: options.id,
      name: options.name,
      kind: videoTrack ? 'video' : 'audio',
      durationSeconds,
      width: videoTrack?.displayWidth,
      height: videoTrack?.displayHeight,
      fps,
      sampleRate: audioTrack?.sampleRate,
      channels: audioTrack?.numberOfChannels,
      hasAudio: Boolean(audioTrack),
      hasVideo: Boolean(videoTrack),
      color: options.palette.color,
      accent: options.palette.accent,
      waveform,
      previewUrl: options.previewUrl,
      thumbnailUrl,
      sourcePath: options.sourcePath,
    }
  } finally {
    input.dispose()
  }
}

async function analyzeLocalMediaFile(file: File, palette: Palette) {
  const previewUrl = URL.createObjectURL(file)
  return analyzeInputMedia(
    new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    }),
    {
      id: createMediaId(file),
      name: file.name,
      previewUrl,
      palette,
    },
  )
}

async function analyzeServerMediaRef(ref: ServerMediaRef, palette: Palette) {
  return analyzeInputMedia(
    new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(ref.url),
    }),
    {
      id: ref.id,
      name: ref.name,
      previewUrl: ref.url,
      palette,
      sourcePath: ref.path,
    },
  )
}

function buildFallbackMediaItem(ref: ServerMediaRef, palette: Palette): MediaItem {
  const kind = inferMediaKind(ref.name)
  return {
    id: ref.id,
    name: ref.name,
    kind,
    durationSeconds: 0,
    hasAudio: kind === 'audio',
    hasVideo: kind === 'video',
    color: palette.color,
    accent: palette.accent,
    waveform: buildFallbackWaveform(ref.name),
    previewUrl: ref.url,
    sourcePath: ref.path,
  }
}

function findClipAtPlayhead(
  clips: ArrangementClip[],
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
) {
  const epsilon = 0.0001
  return clips
    .filter((clip) => {
      const clipEndQ = clip.startQ + secondsToQuarters(clip.durationSeconds, bpm)
      return playheadQ >= clip.startQ - epsilon && playheadQ < clipEndQ - epsilon
    })
    .sort((left, right) => {
      const laneDelta =
        (lanePriority.get(right.laneId) ?? -1) - (lanePriority.get(left.laneId) ?? -1)
      if (laneDelta !== 0) {
        return laneDelta
      }

      return right.startQ - left.startQ
    })[0]
}

function pickMediaByPath(items: MediaItem[], rawPath: string) {
  const normalizedTarget = normalizeMediaPath(rawPath)
  const exactMatch = items.find(
    (item) => item.sourcePath && normalizeMediaPath(item.sourcePath) === normalizedTarget,
  )
  if (exactMatch) {
    return exactMatch
  }

  const targetBase = basename(rawPath).toLowerCase()
  return items.find((item) => item.name.toLowerCase() === targetBase)
}

function mapEffects(source: LvpSession['effects']) {
  return (source ?? []).map<SessionEffect>((effect) => ({
    id: effect.id,
    trackId: effect.trackId,
    effectName: effect.effectName,
    parameters: Object.entries(effect.parameters ?? {}).map(([key, value]) => ({
      key,
      value:
        typeof value.stringValue === 'string'
          ? value.stringValue
          : `${(value.floatValue ?? 0).toFixed(3)}`,
      numericValue: value.floatValue,
    })),
  }))
}

function chooseSessionClip(
  clips: NonNullable<LvpSession['clips']>,
  selection: NonNullable<LvpSession['selections']>[number],
) {
  return (
    clips.find((clip) => {
      const clipEnd = clip.frameStart + Math.max(clip.frameCount, 1)
      return selection.frameStart >= clip.frameStart && selection.frameStart < clipEnd
    }) ??
    clips
      .filter((clip) => clip.trackId === selection.trackId)
      .sort((left, right) => {
        const leftEnd = left.frameStart + Math.max(left.frameCount, 1)
        const rightEnd = right.frameStart + Math.max(right.frameCount, 1)
        const leftOverlap =
          Math.min(selection.frameEnd, leftEnd) - Math.max(selection.frameStart, left.frameStart)
        const rightOverlap =
          Math.min(selection.frameEnd, rightEnd) - Math.max(selection.frameStart, right.frameStart)
        return rightOverlap - leftOverlap
      })[0]
  )
}

function sessionToProject(session: LvpSession, mediaItems: MediaItem[]) {
  const bpm = session.timeline?.bpm ?? 120
  const fps = session.timeline?.fps ?? 30
  const lanes = (session.mainTracks ?? DEFAULT_LANES).map<Lane>((track) => ({
    id: track.id,
    name: track.name,
    colorIndex: track.colorIndex ?? -1,
  }))
  const sourceTracks = (session.tracks ?? []).map<SourceTrack>((track) => ({
    id: track.id,
    name: track.name,
    colorIndex: track.colorIndex ?? -1,
    recordingPaths: (track.recordings ?? []).map((recording) => recording.filename),
  }))
  const nameByTrack = new Map(sourceTracks.map((track) => [track.id, track.name]))

  const arrangementClips: ArrangementClip[] = []

  for (const selection of session.selections ?? []) {
    const sourceClip = chooseSessionClip(session.clips ?? [], selection)
    if (!sourceClip) {
      continue
    }

    const swatch =
      getSwatch(sourceTracks.find((track) => track.id === selection.trackId)?.colorIndex ?? 0)
    const media = pickMediaByPath(mediaItems, sourceClip.filePath)
    const trimStartFrames =
      (sourceClip.clipStart ?? 0) +
      (selection.frameStart - sourceClip.frameStart) +
      (sourceClip.frameOffset ?? 0)
    const startSeconds = selection.frameStart / fps
    const durationSeconds = Math.max(1, selection.frameEnd - selection.frameStart) / fps

    arrangementClips.push({
      id: `selection-${selection.id}`,
      sourceTrackId: selection.trackId,
      laneId: selection.mainTrackId,
      label: nameByTrack.get(selection.trackId) ?? sourceClip.name ?? `Track ${selection.trackId}`,
      mediaPath: sourceClip.filePath,
      mediaId: media?.id,
      startQ: secondsToQuarters(startSeconds, bpm),
      durationSeconds,
      trimStartSeconds: Math.max(0, trimStartFrames) / fps,
      tint: swatch.color,
      accent: swatch.accent,
      selected: selection.selected,
    })
  }

  return {
    bpm,
    fps,
    canvasWidth: Math.max(320, session.timeline?.canvasWidth ?? 1080),
    canvasHeight: Math.max(320, session.timeline?.canvasHeight ?? 1920),
    lanes,
    sourceTracks,
    arrangementClips,
    effects: mapEffects(session.effects),
    displaySeconds: session.timeline?.displaySeconds ?? false,
    snapToBeat: session.timeline?.snapToBeat ?? true,
    zoom: clamp(session.timeline?.zoom ?? 1, ZOOM_MIN, ZOOM_MAX),
    playPositionFrames: session.playPosition ?? 0,
    playStartPositionFrames: session.playStartPosition ?? 0,
    masterAudioMediaId: session.audioFilename
      ? pickMediaByPath(mediaItems, session.audioFilename)?.id
      : undefined,
    unresolvedPaths: arrangementClips
      .filter((clip) => !clip.mediaId)
      .map((clip) => basename(clip.mediaPath)),
  }
}

function buildStandaloneProject(mediaItems: MediaItem[]) {
  const lanes = DEFAULT_LANES
  const canvasWidth = mediaItems.find((item) => item.width)?.width ?? 1080
  const canvasHeight = mediaItems.find((item) => item.height)?.height ?? 1920
  const sourceTracks = mediaItems.map<SourceTrack>((item, index) => ({
    id: `import-track-${index}`,
    name: item.name.replace(/\.[^/.]+$/, ''),
    colorIndex: index,
    recordingPaths: [item.name],
  }))
  const arrangementClips = mediaItems.map<ArrangementClip>((item, index) => {
    const swatch = getSwatch(index)
    return {
      id: `import-clip-${item.id}`,
      sourceTrackId: sourceTracks[index]?.id ?? `import-track-${index}`,
      laneId: lanes[index % lanes.length]?.id ?? lanes[0].id,
      label: item.name.replace(/\.[^/.]+$/, ''),
      mediaPath: item.name,
      mediaId: item.id,
      startQ: index * 4,
      durationSeconds: Math.max(1, item.durationSeconds),
      trimStartSeconds: 0,
      tint: swatch.color,
      accent: swatch.accent,
    }
  })
  return { lanes, sourceTracks, arrangementClips, canvasWidth, canvasHeight }
}

function mapSessionEffectsToDevices(
  effects: SessionEffect[],
  laneId: string | undefined,
  kind: MediaKind | undefined,
) {
  const relevant = effects.filter(
    (effect) => effect.trackId === laneId || effect.trackId === '__group_main',
  )

  if (!relevant.length) {
    return kind === 'audio' ? FALLBACK_AUDIO_FX : FALLBACK_VIDEO_FX
  }

  return relevant.map<FxDevice>((effect, index) => {
    const swatch = getSwatch(index)
    return {
      id: effect.id,
      name: effect.effectName,
      subtitle:
        effect.trackId === '__group_main' ? 'Global stack' : `Layer ${effect.trackId}`,
      accent: swatch.accent,
      parameters: effect.parameters.map((parameter) => ({
        label: parameter.key,
        value: clamp(parameter.numericValue ?? 0.5, 0, 1),
        display: parameter.value,
      })),
    }
  })
}

function App() {
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('musical')
  const [signatureId, setSignatureId] = useState('4/4')
  const [snapMode, setSnapMode] = useState<SnapMode>('beat')
  const [bpm, setBpm] = useState(120)
  const [fps, setFps] = useState(30)
  const [canvasWidth, setCanvasWidth] = useState(1080)
  const [canvasHeight, setCanvasHeight] = useState(1920)
  const [zoom, setZoom] = useState(1)
  const [sessionName, setSessionName] = useState<string | null>(null)
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [lanes, setLanes] = useState<Lane[]>(DEFAULT_LANES)
  const [sourceTracks, setSourceTracks] = useState<SourceTrack[]>([])
  const [clips, setClips] = useState<ArrangementClip[]>([])
  const [effects, setEffects] = useState<SessionEffect[]>([])
  const [masterAudioId, setMasterAudioId] = useState<string | undefined>()
  const [selectedClipId, setSelectedClipId] = useState<string>()
  const [selectedFxId, setSelectedFxId] = useState<string>()
  const [playheadQ, setPlayheadQ] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportState, setExportState] = useState<ExportState>({
    phase: 'idle',
    progress: null,
    detail: '',
  })
  const [status, setStatus] = useState(
    'Open a .lvp session file. The Vite dev server will stream its referenced media from disk.',
  )
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [timelineDragState, setTimelineDragState] = useState<TimelineDragState | null>(null)
  const [isTimelineAudibleScrubbing, setIsTimelineAudibleScrubbing] = useState(false)

  const playbackOriginRef = useRef(0)
  const compositionPlayerRef = useRef<CompositionPlayerHandle | null>(null)
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const ffmpegLoadRef = useRef<Promise<void> | null>(null)
  const ffmpegAssetUrlsRef = useRef<{ coreURL: string; wasmURL: string } | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const timelineScrubAudioTimeoutRef = useRef<number | null>(null)

  const signature =
    SIGNATURES.find((candidate) => candidate.id === signatureId) ?? SIGNATURES[0]
  const beatUnit = 4 / signature.denominator
  const barLength = signature.numerator * beatUnit
  const snapUnit = getSnapUnit(snapMode, signature)
  const quarterPx = BASE_QUARTER_PX * zoom

  let totalQuarters = barLength * 12
  for (const clip of clips) {
    totalQuarters = Math.max(
      totalQuarters,
      clip.startQ + secondsToQuarters(clip.durationSeconds, bpm) + barLength,
    )
  }

  const timelineWidth = totalQuarters * quarterPx
  const gridStyle = {
    backgroundImage:
      'linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.16) 1px, transparent 1px)',
    backgroundSize: `${beatUnit * quarterPx}px 100%, ${barLength * quarterPx}px 100%`,
  }
  const selectedClip =
    clips.find((clip) => clip.id === selectedClipId) ??
    clips.find((clip) => clip.selected) ??
    clips[0]
  const selectedMedia = mediaItems.find((item) => item.id === selectedClip?.mediaId)
  const lanePriority = new Map(lanes.map((lane, index) => [lane.id, index]))
  const playheadClip = findClipAtPlayhead(clips, playheadQ, bpm, lanePriority)
  const previewClip = playheadClip ?? selectedClip
  const previewMedia = mediaItems.find((item) => item.id === previewClip?.mediaId)
  const selectedTrack = sourceTracks.find((track) => track.id === selectedClip?.sourceTrackId)
  const fxDevices = mapSessionEffectsToDevices(effects, selectedClip?.laneId, selectedMedia?.kind)
  const selectedFx = fxDevices.find((device) => device.id === selectedFxId) ?? fxDevices[0]
  const playheadSeconds = quartersToSeconds(playheadQ, bpm)
  const masterAudio = mediaItems.find((item) => item.id === masterAudioId)
  const projectWaveform =
    masterAudio?.waveform.length
      ? masterAudio.waveform
      : buildProjectWaveform(clips, totalQuarters, bpm, 264)
  const barCount = Math.ceil(totalQuarters / barLength)
  const rulerBars = Array.from({ length: barCount }, (_, index) => ({
    index,
    quarter: index * barLength,
  }))
  const unresolvedCount = clips.filter((clip) => !clip.mediaId).length
  const exportButtonLabel = isExporting
    ? exportState.progress !== null
      ? `${exportState.progress}%`
      : exportState.phase === 'loading-ffmpeg'
        ? 'Loading...'
        : exportState.phase === 'muxing'
          ? 'Muxing...'
          : exportState.phase === 'decoding-audio'
            ? 'Audio...'
            : 'Render...'
    : 'Export'

  function updateExportState(
    phase: ExportState['phase'],
    detail: string,
    progress: number | null = null,
  ) {
    setExportState({
      phase,
      detail,
      progress,
    })
    setStatus(detail)
  }

  function stopTimelineAudibleScrub() {
    if (timelineScrubAudioTimeoutRef.current !== null) {
      window.clearTimeout(timelineScrubAudioTimeoutRef.current)
      timelineScrubAudioTimeoutRef.current = null
    }

    setIsTimelineAudibleScrubbing(false)
  }

  function pulseTimelineAudibleScrub() {
    if (timelineScrubAudioTimeoutRef.current !== null) {
      window.clearTimeout(timelineScrubAudioTimeoutRef.current)
    }

    setIsTimelineAudibleScrubbing(true)
    timelineScrubAudioTimeoutRef.current = window.setTimeout(() => {
      timelineScrubAudioTimeoutRef.current = null
      setIsTimelineAudibleScrubbing(false)
    }, TIMELINE_SCRUB_AUDIO_TAIL_MS)
  }

  async function ensureFfmpeg() {
    if (ffmpegRef.current?.loaded) {
      return ffmpegRef.current
    }

    if (!ffmpegRef.current) {
      const ffmpeg = new FFmpeg()
      ffmpeg.on('log', ({ message }) => {
        logClient('ffmpeg:log', { message })
      })
      ffmpeg.on('progress', ({ progress, time }) => {
        logClient('ffmpeg:progress', { progress, time })
        setExportState((current) => {
          if (current.phase !== 'loading-ffmpeg' && current.phase !== 'muxing') {
            return current
          }

          const completion = Math.max(0, Math.min(100, Math.round(progress * 100)))
          return {
            phase: 'muxing',
            progress: completion,
            detail: `Muxing audio into final MP4 with ffmpeg.wasm (${completion}%)...`,
          }
        })
      })
      ffmpegRef.current = ffmpeg
    }

    if (!ffmpegLoadRef.current) {
      updateExportState('loading-ffmpeg', 'Loading ffmpeg.wasm core...', 0)
      logClient('export:phase', { phase: 'loading-ffmpeg' })
      const assetUrlsPromise = ffmpegAssetUrlsRef.current
        ? Promise.resolve(ffmpegAssetUrlsRef.current)
        : Promise.all([
            toBlobURL(FFMPEG_CORE_URL, 'text/javascript', true),
            toBlobURL(FFMPEG_WASM_URL, 'application/wasm', true),
          ]).then(([coreURL, wasmURL]) => {
            const next = { coreURL, wasmURL }
            ffmpegAssetUrlsRef.current = next
            return next
          })

      ffmpegLoadRef.current = ffmpegRef.current
        .load(
          await assetUrlsPromise,
        )
        .then(() => undefined)
        .finally(() => {
          ffmpegLoadRef.current = null
        })
    }

    await ffmpegLoadRef.current
    return ffmpegRef.current
  }

  useEffect(() => {
    if (!selectedClip && clips.length) {
      setSelectedClipId(clips[0].id)
    }
  }, [clips, selectedClip])

  useEffect(
    () => () => {
      stopTimelineAudibleScrub()
      ffmpegRef.current?.terminate()
      if (ffmpegAssetUrlsRef.current) {
        URL.revokeObjectURL(ffmpegAssetUrlsRef.current.coreURL)
        URL.revokeObjectURL(ffmpegAssetUrlsRef.current.wasmURL)
        ffmpegAssetUrlsRef.current = null
      }
    },
    [],
  )

  useEffect(() => {
    if (!fxDevices.length) {
      return
    }

    if (!fxDevices.some((device) => device.id === selectedFxId)) {
      setSelectedFxId(fxDevices[0].id)
    }
  }, [fxDevices, selectedFxId])

  useEffect(() => {
    if (!selectedClip) {
      return
    }

    if (!isPlaying) {
      setPlayheadQ(selectedClip.startQ)
    }
  }, [isPlaying, selectedClipId, selectedClip?.startQ])

  useEffect(() => {
    if (!dragState) {
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      const targetClip = clips.find((clip) => clip.id === dragState.clipId)
      if (!targetClip) {
        return
      }

      const deltaQuarters = (event.clientX - dragState.pointerStart) / quarterPx
      const snapped = Math.round((dragState.originQ + deltaQuarters) / snapUnit) * snapUnit
      const maxStart = Math.max(
        0,
        totalQuarters - secondsToQuarters(targetClip.durationSeconds, bpm) - beatUnit,
      )

      setClips((currentClips) =>
        currentClips.map((clip) =>
          clip.id === dragState.clipId
            ? { ...clip, startQ: clamp(snapped, 0, maxStart) }
            : clip,
        ),
      )
    }

    const onPointerUp = () => setDragState(null)

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [beatUnit, bpm, clips, dragState, quarterPx, snapUnit, totalQuarters])

  useEffect(() => {
    if (!timelineDragState) {
      stopTimelineAudibleScrub()
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) {
        return
      }

      const timelineScroll = timelineScrollRef.current
      if (!timelineScroll) {
        return
      }

      const rawVerticalDelta = timelineDragState.pointerStartY - event.clientY
      const zoomDelta =
        Math.abs(rawVerticalDelta) <= TIMELINE_DRAG_ZOOM_THRESHOLD_PX
          ? 0
          : Math.sign(rawVerticalDelta) *
            (Math.abs(rawVerticalDelta) - TIMELINE_DRAG_ZOOM_THRESHOLD_PX)
      const nextZoom = clamp(
        timelineDragState.originZoom + zoomDelta * TIMELINE_DRAG_ZOOM_SPEED,
        ZOOM_MIN,
        ZOOM_MAX,
      )
      const nextQuarterPx = BASE_QUARTER_PX * nextZoom
      const deltaX = event.clientX - timelineDragState.pointerStartX
      const nextPlayheadQ = clamp(
        timelineDragState.originPlayheadQ + deltaX / nextQuarterPx,
        0,
        totalQuarters,
      )
      const timelineBounds = timelineScroll.getBoundingClientRect()
      const pointerX = clamp(event.clientX - timelineBounds.left, 0, timelineScroll.clientWidth)
      const maxScrollLeft = Math.max(
        0,
        LABEL_WIDTH + totalQuarters * nextQuarterPx - timelineScroll.clientWidth,
      )

      timelineScroll.scrollLeft = clamp(
        LABEL_WIDTH + nextPlayheadQ * nextQuarterPx - pointerX,
        0,
        maxScrollLeft,
      )
      pulseTimelineAudibleScrub()
      setZoom(nextZoom)
      setPlayheadQ(nextPlayheadQ)
      playbackOriginRef.current = nextPlayheadQ
    }

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== timelineDragState.pointerId) {
        return
      }

      stopTimelineAudibleScrub()
      setTimelineDragState(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [timelineDragState, totalQuarters])

  useEffect(() => {
    if (!isPlaying) {
      return
    }

    let animationFrame = 0
    const startedAt = performance.now()
    const originQ = playbackOriginRef.current

    const step = (timestamp: number) => {
      const elapsed = (timestamp - startedAt) / 1000
      const nextQ = originQ + secondsToQuarters(elapsed, bpm)

      if (nextQ >= totalQuarters) {
        setPlayheadQ(totalQuarters)
        setIsPlaying(false)
        return
      }

      setPlayheadQ(nextQ)
      animationFrame = window.requestAnimationFrame(step)
    }

    animationFrame = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [bpm, isPlaying, totalQuarters])

  async function handleImportSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) {
      return
    }

    try {
      setStatus(`Analyzing ${files.length} imported media file(s) with MediaBunny...`)
      const analyzed = await Promise.all(
        files.map((file, index) =>
          analyzeLocalMediaFile(file, PALETTE[(mediaItems.length + index) % PALETTE.length]),
        ),
      )

      const nextMedia = [...mediaItems, ...analyzed]
      setMediaItems(nextMedia)

      if (!sessionName) {
        const standalone = buildStandaloneProject(nextMedia)
        setLanes(standalone.lanes)
        setSourceTracks(standalone.sourceTracks)
        setClips(standalone.arrangementClips)
        setCanvasWidth(standalone.canvasWidth)
        setCanvasHeight(standalone.canvasHeight)
        setSelectedClipId(standalone.arrangementClips[0]?.id)
      }

      setStatus(`Imported ${analyzed.length} media file(s) locally.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus(`Media import failed: ${message}`)
    }
  }

  async function openSessionFile(file: File) {
    setStatus(`Opening ${file.name} through the Vite dev server...`)
    logClient('openSessionFile:start', {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    })

    try {
      const sessionContents = await file.text()
      logClient('openSessionFile:read', {
        name: file.name,
        chars: sessionContents.length,
      })

      const response = await fetch('/api/session/open-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionName: file.name,
          sessionContents,
        }),
      })
      logClient('openSessionFile:response', {
        ok: response.ok,
        status: response.status,
      })

      const payload = (await response.json()) as SessionOpenResponse | { error: string }
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : `Request failed with ${response.status}`)
      }

      const existingRefs = payload.mediaRefs.filter((ref) => ref.exists)
      const missingRefs = payload.mediaRefs.filter((ref) => !ref.exists)
      logClient('openSessionFile:mediaRefs', {
        total: payload.mediaRefs.length,
        existing: existingRefs.length,
        missing: missingRefs.length,
      })

      setStatus(`Analyzing ${existingRefs.length} session media file(s) with MediaBunny...`)
      let degradedAnalysisCount = 0
      const analyzedMedia = await Promise.all(
        existingRefs.map(async (ref, index) => {
          const palette = PALETTE[index % PALETTE.length]

          try {
            return await analyzeServerMediaRef(ref, palette)
          } catch (error) {
            degradedAnalysisCount += 1
            const message = error instanceof Error ? error.message : String(error)
            logClient('openSessionFile:analyzeFallback', {
              path: ref.path,
              message,
            })
            return buildFallbackMediaItem(ref, palette)
          }
        }),
      )
      logClient('openSessionFile:analyzedMedia', {
        analyzed: analyzedMedia.length,
        degraded: degradedAnalysisCount,
      })

      const project = sessionToProject(payload.session, analyzedMedia)
      logClient('openSessionFile:project', {
        clips: project.arrangementClips.length,
        lanes: project.lanes.length,
        sourceTracks: project.sourceTracks.length,
      })

      setSessionName(payload.sessionName)
      setMediaItems(analyzedMedia)
      setBpm(project.bpm)
      setFps(project.fps)
      setCanvasWidth(project.canvasWidth)
      setCanvasHeight(project.canvasHeight)
      setTimelineMode(project.displaySeconds ? 'timecode' : 'musical')
      setSnapMode(project.snapToBeat ? 'beat' : 'quarter')
      setZoom(project.zoom)
      setLanes(project.lanes.length ? project.lanes : DEFAULT_LANES)
      setSourceTracks(project.sourceTracks)
      setClips(project.arrangementClips)
      setEffects(project.effects)
      setMasterAudioId(project.masterAudioMediaId)

      const preferredClip =
        project.arrangementClips.find((clip) => clip.selected) ?? project.arrangementClips[0]
      setSelectedClipId(preferredClip?.id)
      setPlayheadQ(secondsToQuarters(project.playPositionFrames / project.fps, project.bpm))

      if (missingRefs.length) {
        setStatus(
          `Loaded ${payload.sessionName}. ${missingRefs.length} referenced media file(s) are missing on disk.`,
        )
      } else if (degradedAnalysisCount) {
        setStatus(
          `Loaded ${payload.sessionName}. ${degradedAnalysisCount} media file(s) are using browser playback fallback.`,
        )
      } else {
        setStatus(`Loaded ${payload.sessionName} with all media streaming from disk.`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logClient('openSessionFile:error', { message })
      setStatus(`Failed to open session: ${message}`)
    }
  }

  async function handleSessionFileSelection(event: ChangeEvent<HTMLInputElement>) {
    logClient('handleSessionFileSelection:change', {
      fileCount: event.target.files?.length ?? 0,
    })
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      logClient('handleSessionFileSelection:empty')
      return
    }

    await openSessionFile(file)
  }

  async function handleExport() {
    if (isExporting) {
      return
    }

    if (!clips.length) {
      setStatus('Open a session or import media before exporting.')
      return
    }

    const compositionPlayer = compositionPlayerRef.current
    const canvas = compositionPlayer?.getCanvas()
    if (!compositionPlayer || !canvas) {
      setStatus('The composition preview is not ready for export yet.')
      return
    }

    const durationSeconds = Math.max(
      0.01,
      masterAudio?.durationSeconds ?? 0,
      ...clips.map((clip) => quartersToSeconds(clip.startQ, bpm) + clip.durationSeconds),
    )
    const outputFrameRate = Math.max(1, fps)
    const outputFrameDuration = 1 / outputFrameRate
    const outputFrameCount = Math.max(1, Math.ceil(durationSeconds * outputFrameRate))
    const exportName = `${sanitizeFilenameSegment(sessionName ?? 'zvid-session')}.mp4`

    let saveTarget: SaveTarget
    try {
      saveTarget = await prepareSaveTarget(exportName)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('Export canceled before rendering.')
        return
      }

      setStatus(`Failed to prepare export destination: ${message}`)
      return
    }

    setIsPlaying(false)
    setIsExporting(true)
    updateExportState('preparing', `Preparing export (${outputFrameCount} frame(s))...`, null)
    logClient('export:start', {
      durationSeconds,
      frameRate: outputFrameRate,
      frames: outputFrameCount,
      canvasWidth,
      canvasHeight,
      masterAudio: masterAudio?.name,
    })
    logClient('export:phase', { phase: 'preparing', frames: outputFrameCount })

    const previousPlayheadQ = playheadQ

    try {
      updateExportState('preparing', 'Checking H.264 encoder support...', null)
      logClient('export:phase', { phase: 'encoder-check:start' })
      const canEncodeAvc = await canEncodeVideo('avc', {
        width: canvasWidth,
        height: canvasHeight,
        bitrate: QUALITY_HIGH,
      })
      logClient('export:phase', { phase: 'encoder-check:complete', supported: canEncodeAvc })
      if (!canEncodeAvc) {
        throw new Error('This runtime cannot encode H.264 video for MP4 export.')
      }

      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      })
      const videoSource = new CanvasSource(canvas, {
        codec: 'avc',
        bitrate: QUALITY_HIGH,
        keyFrameInterval: 2,
        sizeChangeBehavior: 'cover',
      })
      output.addVideoTrack(videoSource, {
        frameRate: outputFrameRate,
        name: 'Program',
      })

      updateExportState('preparing', 'Starting MediaBunny MP4 encoder...', null)
      logClient('export:phase', { phase: 'output-start:start' })
      await output.start()
      logClient('export:phase', { phase: 'output-start:complete' })
      let intermediateMimeType = 'video/mp4'
      updateExportState('rendering', `Rendering ${outputFrameCount} frame(s) from the preview canvas...`, null)
      logClient('export:phase', { phase: 'rendering', frames: outputFrameCount })

      for (let frameIndex = 0; frameIndex < outputFrameCount; frameIndex += 1) {
        const frameSeconds = Math.min(durationSeconds, frameIndex * outputFrameDuration)
        const frameQ = secondsToQuarters(frameSeconds, bpm)
        if (frameIndex === 0) {
          updateExportState('rendering', `Rendering frame 1/${outputFrameCount}...`, null)
          logClient('export:first-frame:start', {
            frame: 1,
            seconds: frameSeconds,
            quarters: frameQ,
          })
          await yieldToBrowser()
        }
        await compositionPlayer.renderFrameAt(frameQ, frameSeconds)
        await videoSource.add(frameSeconds, outputFrameDuration)
        if (frameIndex === 0) {
          logClient('export:first-frame:complete', {
            frame: 1,
          })
        }

        if (
          frameIndex === 0 ||
          frameIndex === outputFrameCount - 1 ||
          frameIndex % Math.max(1, Math.floor(outputFrameRate)) === 0
        ) {
          const completion = Math.round(((frameIndex + 1) / outputFrameCount) * 100)
          setPlayheadQ(frameQ)
          updateExportState(
            'rendering',
            `Rendering ${frameIndex + 1}/${outputFrameCount} frames (${completion}%)...`,
            completion,
          )
          logClient('export:progress', {
            frame: frameIndex + 1,
            totalFrames: outputFrameCount,
            completion,
          })
          await yieldToBrowser()
        }
      }

      videoSource.close()
      await output.finalize()
      intermediateMimeType = await output.getMimeType().catch(() => 'video/mp4')

      const intermediateBuffer = output.target.buffer
      if (!intermediateBuffer) {
        throw new Error('MediaBunny did not return an output buffer.')
      }

      let masterAudioBuffer: AudioBuffer | null = null
      if (masterAudio?.previewUrl && masterAudio.hasAudio) {
        updateExportState('decoding-audio', 'Decoding master audio for export...', null)
        logClient('export:phase', { phase: 'decoding-audio' })
        masterAudioBuffer = await decodeAudioBufferFromUrl(
          masterAudio.previewUrl,
          durationSeconds,
          (progress, detail) => {
            updateExportState('decoding-audio', detail, progress)
            logClient('export:audioDecodeProgress', { progress })
          },
        )
        if (!masterAudioBuffer) {
          logClient('export:audioSkipped', { reason: 'No decodable primary audio track.' })
        }
      }

      if (masterAudioBuffer) {
        updateExportState('loading-ffmpeg', 'Loading ffmpeg.wasm core...', 0)
        const ffmpeg = await ensureFfmpeg()
        updateExportState('muxing', 'Muxing audio into final MP4 with ffmpeg.wasm...', 0)
        logClient('export:phase', { phase: 'muxing' })
        const videoFileName = 'render.mp4'
        const audioFileName = 'master.wav'
        const outputFileName = 'final.mp4'

        try {
          await ffmpeg.writeFile(videoFileName, new Uint8Array(intermediateBuffer))
          await ffmpeg.writeFile(audioFileName, encodeAudioBufferAsWav(masterAudioBuffer))

          const exitCode = await ffmpeg.exec([
            '-i',
            videoFileName,
            '-i',
            audioFileName,
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-shortest',
            outputFileName,
          ])
          if (exitCode !== 0) {
            throw new Error(`ffmpeg.wasm exited with code ${exitCode}.`)
          }

          const muxedData = await ffmpeg.readFile(outputFileName)
          const finalBuffer =
            muxedData instanceof Uint8Array
              ? toArrayBuffer(muxedData)
              : toArrayBuffer(await blobToUint8Array(new Blob([muxedData])))

          const saveMethod = await saveBlob(new Blob([finalBuffer], { type: 'video/mp4' }), saveTarget)
          setStatus(
            saveMethod === 'picker'
              ? `Saved ${exportName}.`
              : `Exported ${exportName} through the browser download flow.`,
          )
          setExportState({ phase: 'idle', progress: null, detail: '' })
          logClient('export:complete', {
            filename: exportName,
            bytes: finalBuffer.byteLength,
            mimeType: 'video/mp4',
            muxedWith: 'ffmpeg.wasm',
            saveMethod,
          })
        } finally {
          await Promise.allSettled([
            ffmpeg.deleteFile(videoFileName),
            ffmpeg.deleteFile(audioFileName),
            ffmpeg.deleteFile(outputFileName),
          ])
        }
      } else {
        const saveMethod = await saveBlob(
          new Blob([intermediateBuffer], { type: intermediateMimeType }),
          saveTarget,
        )
        setStatus(
          saveMethod === 'picker'
            ? `Saved ${exportName}.`
            : `Exported ${exportName} through the browser download flow.`,
        )
        setExportState({ phase: 'idle', progress: null, detail: '' })
        logClient('export:complete', {
          filename: exportName,
          bytes: intermediateBuffer.byteLength,
          mimeType: intermediateMimeType,
          muxedWith: 'mediabunny',
          saveMethod,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportState({ phase: 'idle', progress: null, detail: '' })
      setStatus(`Export failed: ${message}`)
      logClient('export:error', { message })
    } finally {
      setIsExporting(false)
      setExportState({ phase: 'idle', progress: null, detail: '' })
      setPlayheadQ(previousPlayheadQ)
      try {
        await compositionPlayer.restorePreviewSurface(
          previousPlayheadQ,
          quartersToSeconds(previousPlayheadQ, bpm),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logClient('export:restorePreviewSurface:error', { message })
      }
    }
  }

  async function handleTransportToggle() {
    if (!clips.length || isExporting) {
      return
    }

    if (isPlaying) {
      setIsPlaying(false)
      return
    }

    playbackOriginRef.current = playheadQ
    setIsPlaying(true)
  }

  function jumpPlayhead(deltaBars: number) {
    if (isExporting) {
      return
    }

    const next = clamp(playheadQ + deltaBars * barLength, 0, totalQuarters)
    setPlayheadQ(next)
    playbackOriginRef.current = next
  }

  function selectSource(sourceTrackId: string) {
    const match = clips.find((clip) => clip.sourceTrackId === sourceTrackId)
    if (match) {
      setSelectedClipId(match.id)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__group">
          <label
            className="file-button ghost-button"
            onClick={() => logClient('openControl:click')}
          >
            Open
            <input
              accept=".lvp,application/json"
              className="file-button__input"
              onClick={() => logClient('openInput:click')}
              onChange={handleSessionFileSelection}
              type="file"
            />
          </label>
          <label className="file-button ghost-button ghost-button--accent">
            Import
            <input
              accept="video/*,audio/*,.mp4,.mov,.mkv,.webm,.avi,.wav,.mp3,.m4a,.flac,.aif,.aiff"
              className="file-button__input"
              multiple
              onChange={handleImportSelection}
              type="file"
            />
          </label>
          <button
            className="ghost-button"
            onClick={() => setStatus('Save/export is not wired yet in the dev-server refactor.')}
            disabled={isExporting}
            type="button"
          >
            Save
          </button>
          <div className="tempo-pill">
            <button
              className="tempo-pill__adjust"
              onClick={() => setBpm((current) => clamp(current - 5, 60, 220))}
              type="button"
            >
              -
            </button>
            <span>{bpm.toFixed(0)} BPM</span>
            <button
              className="tempo-pill__adjust"
              onClick={() => setBpm((current) => clamp(current + 5, 60, 220))}
              type="button"
            >
              +
            </button>
          </div>
        </div>

        <div className="brand-mark" aria-label="Zvid logo">
          <svg viewBox="0 0 120 24" role="img" aria-hidden="true">
            <circle cx="14" cy="12" r="8" />
            <circle cx="36" cy="12" r="8" />
            <circle cx="60" cy="12" r="10" />
            <circle cx="84" cy="12" r="8" />
            <circle cx="106" cy="12" r="8" />
          </svg>
        </div>

        <div className="topbar__group topbar__group--right">
          <button
            className="ghost-button"
            disabled={isExporting}
            onClick={handleExport}
            type="button"
          >
            {exportButtonLabel}
          </button>
          <button
            className="ghost-button"
            onClick={() =>
              setStatus('Use Open to pick a .lvp file. The dev server will stream the referenced files automatically.')
            }
            type="button"
          >
            Help
          </button>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace__main">
          <section className="editor-panel">
            <div className="timeline-toolbar">
              <div className="timeline-toolbar__display">
                <span className="status-light" />
                <span>{formatTimecode(playheadSeconds, fps)}</span>
                <strong>{formatMusicalPosition(playheadQ, signature)}</strong>
              </div>

              <div className="timeline-toolbar__controls">
                <div className="segmented-control" role="tablist" aria-label="Timeline scale">
                  <button
                    className={timelineMode === 'musical' ? 'is-active' : ''}
                    onClick={() => setTimelineMode('musical')}
                    type="button"
                  >
                    Tempo
                  </button>
                  <button
                    className={timelineMode === 'timecode' ? 'is-active' : ''}
                    onClick={() => setTimelineMode('timecode')}
                    type="button"
                  >
                    SMPTE
                  </button>
                </div>

                <div className="segmented-control" role="tablist" aria-label="Snap grid">
                  {SNAP_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      className={snapMode === option.id ? 'is-active' : ''}
                      onClick={() => setSnapMode(option.id)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <label className="signature-picker">
                  <span>Time Sig</span>
                  <select value={signatureId} onChange={(event) => setSignatureId(event.target.value)}>
                    {SIGNATURES.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="editor-grid">
              <div ref={timelineScrollRef} className="timeline-scroll">
                <div
                  className="timeline-canvas"
                  style={{ width: LABEL_WIDTH + timelineWidth, ['--label-width' as string]: `${LABEL_WIDTH}px` }}
                >
                  <div
                    className="timeline-playhead"
                    style={{ left: LABEL_WIDTH + playheadQ * quarterPx }}
                  />

                  <section className="ruler-row">
                    <div className="track-label track-label--header">
                      <span>{sessionName ?? 'Session'}</span>
                      <small>{unresolvedCount ? `${unresolvedCount} unresolved media file(s)` : 'Media linked'}</small>
                    </div>
                    <div
                      className={`ruler-row__content ruler-row__content--interactive ${
                        timelineDragState ? 'is-dragging' : ''
                      }`}
                      onPointerDown={(event) => {
                        if (isExporting) {
                          return
                        }

                        const timelineScroll = timelineScrollRef.current
                        if (!timelineScroll) {
                          return
                        }

                        event.preventDefault()
                        stopTimelineAudibleScrub()
                        setIsPlaying(false)

                        const timelineBounds = timelineScroll.getBoundingClientRect()
                        const pointerX = event.clientX - timelineBounds.left
                        const nextPlayheadQ = clamp(
                          (timelineScroll.scrollLeft - LABEL_WIDTH + pointerX) / quarterPx,
                          0,
                          totalQuarters,
                        )

                        setPlayheadQ(nextPlayheadQ)
                        playbackOriginRef.current = nextPlayheadQ
                        setTimelineDragState({
                          pointerId: event.pointerId,
                          pointerStartX: event.clientX,
                          pointerStartY: event.clientY,
                          originPlayheadQ: nextPlayheadQ,
                          originZoom: zoom,
                        })
                      }}
                      style={gridStyle}
                    >
                      {rulerBars.map((bar) => (
                        <div
                          key={bar.index}
                          className="ruler-marker"
                          style={{ left: bar.quarter * quarterPx }}
                        >
                          <span>
                            {timelineMode === 'musical'
                              ? `${bar.index + 1}`
                              : formatTimecode(quartersToSeconds(bar.quarter, bpm), fps)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {lanes.map((lane) => (
                    <section key={lane.id} className="track-row">
                      <div className="track-label">
                        <div className="track-label__index">{lane.name.replace('Layer ', '')}</div>
                        <div>
                          <span>{lane.name}</span>
                          <small>FX rack armed</small>
                        </div>
                        <button className="track-label__fx" type="button">
                          fx
                        </button>
                      </div>
                      <div className="track-row__content" style={gridStyle}>
                        {clips
                          .filter((clip) => clip.laneId === lane.id)
                          .map((clip) => {
                            const selected = clip.id === selectedClip?.id
                            return (
                              <button
                                key={clip.id}
                                className={`clip-card ${selected ? 'clip-card--selected' : ''}`}
                                onClick={() => setSelectedClipId(clip.id)}
                                onPointerDown={(event) => {
                                  event.preventDefault()
                                  setSelectedClipId(clip.id)
                                  setDragState({
                                    clipId: clip.id,
                                    pointerStart: event.clientX,
                                    originQ: clip.startQ,
                                  })
                                }}
                                style={{
                                  left: clip.startQ * quarterPx,
                                  width: secondsToQuarters(clip.durationSeconds, bpm) * quarterPx,
                                  backgroundColor: clip.tint,
                                  borderColor: clip.accent,
                                  boxShadow: selected ? `0 0 0 2px ${clip.accent}` : undefined,
                                  opacity: clip.mediaId ? 1 : 0.62,
                                }}
                                type="button"
                              >
                                <strong>{clip.label}</strong>
                                <span>
                                  {formatMusicalPosition(clip.startQ, signature)} /{' '}
                                  {formatDuration(clip.durationSeconds)}
                                  {clip.mediaId ? '' : ' / missing'}
                                </span>
                              </button>
                            )
                          })}
                      </div>
                    </section>
                  ))}

                  <section className="track-row track-row--bus">
                    <div className="track-label">
                      <div className="track-label__index">A</div>
                      <div>
                        <span>Audio</span>
                        <small>
                          {masterAudio ? masterAudio.name : 'Master bus / session waveform'}
                        </small>
                      </div>
                    </div>
                    <div className="track-row__content track-row__content--waveform" style={gridStyle}>
                      <div className="waveform">
                        {projectWaveform.map((value, index) => (
                          <span
                            key={`${index}-${value}`}
                            className="waveform__bar"
                            style={{
                              left: `${(index / Math.max(1, projectWaveform.length - 1)) * 100}%`,
                              height: `${16 + value * 42}px`,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="source-header">
                    <div className="track-label track-label--header">
                      <span>Source Tracks</span>
                      <small>{sourceTracks.length || mediaItems.length} tracks in session</small>
                    </div>
                    <div className="source-header__content">
                      <span>Vite dev middleware streams session media directly from disk.</span>
                    </div>
                  </section>

                  {(sourceTracks.length ? sourceTracks : buildStandaloneProject(mediaItems).sourceTracks).map((track) => {
                    const sourceClips = clips.filter((clip) => clip.sourceTrackId === track.id)
                    const swatch = getSwatch(track.colorIndex)

                    return (
                      <section key={track.id} className="track-row track-row--source">
                        <button
                          className="track-label track-label--source"
                          onClick={() => selectSource(track.id)}
                          type="button"
                        >
                          <span
                            className="track-label__stripe"
                            style={{ backgroundColor: swatch.accent }}
                          />
                          <div>
                            <span>{track.name}</span>
                            <small>
                              {track.recordingPaths.length
                                ? `${track.recordingPaths.length} file(s)`
                                : 'Imported media'}
                            </small>
                          </div>
                        </button>
                        <div className="track-row__content track-row__content--source" style={gridStyle}>
                          {sourceClips.map((clip) => {
                            const media = mediaItems.find((item) => item.id === clip.mediaId)
                            return (
                              <div
                                key={clip.id}
                                className="source-span"
                                style={{
                                  left: clip.startQ * quarterPx,
                                  width: secondsToQuarters(clip.durationSeconds, bpm) * quarterPx,
                                  backgroundColor: clip.tint,
                                  borderColor: clip.accent,
                                  opacity: clip.mediaId ? 1 : 0.56,
                                }}
                              >
                                <div
                                  className="source-span__thumb"
                                  style={
                                    media?.thumbnailUrl
                                      ? {
                                          backgroundImage: `url(${media.thumbnailUrl})`,
                                          backgroundSize: 'cover',
                                          backgroundPosition: 'center',
                                        }
                                      : undefined
                                  }
                                />
                                <div className="source-span__body">
                                  <span>{clip.label}</span>
                                  <div className="source-span__line" style={{ backgroundColor: clip.accent }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </div>

              <aside className="preview-panel">
                <div className="preview-panel__header">
                  <div>
                    <strong>Program</strong>
                    <span>{previewClip ? previewClip.label : 'No clip at playhead'}</span>
                  </div>
                  <span className="preview-panel__mode">
                    {previewMedia?.kind === 'audio' ? 'Audio' : 'Video'}
                  </span>
                </div>

                <div className="preview-monitor">
                  <CompositionPlayer
                    ref={compositionPlayerRef}
                    bpm={bpm}
                    canvasHeight={canvasHeight}
                    canvasWidth={canvasWidth}
                    clips={clips}
                    effects={effects}
                    isPlaying={isPlaying}
                    isScrubbing={Boolean(timelineDragState)}
                    isAudibleScrubbing={isTimelineAudibleScrubbing}
                    lanes={lanes}
                    masterAudio={masterAudio}
                    mediaItems={mediaItems}
                    playheadQ={playheadQ}
                    playheadSeconds={playheadSeconds}
                  />
                  {!previewClip ? (
                    <div className="preview-placeholder">
                      <div className="preview-placeholder__overlay">
                        <strong>No clip at playhead</strong>
                        <span>
                          {isPlaying
                            ? 'The playhead is currently in a gap between clips.'
                            : 'Move the playhead onto a clip or start playback to render the session comp.'}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="preview-meta">
                  <div className="preview-meta__row">
                    <span>Session</span>
                    <strong>{sessionName ?? 'Untitled session'}</strong>
                  </div>
                  <div className="preview-meta__row">
                    <span>Timeline</span>
                    <strong>{timelineMode === 'musical' ? 'Tempo ruler' : 'SMPTE ruler'}</strong>
                  </div>
                  <div className="preview-meta__row">
                    <span>Resolution</span>
                    <strong>
                      {canvasWidth} x {canvasHeight}
                    </strong>
                  </div>
                  <div className="preview-meta__row">
                    <span>Audio</span>
                    <strong>
                      {previewMedia?.sampleRate
                        ? `${previewMedia.sampleRate} Hz / ${previewMedia.channels ?? 2} ch`
                        : previewMedia?.hasAudio
                          ? 'Embedded'
                          : 'None'}
                    </strong>
                  </div>
                </div>
              </aside>
            </div>

            <div className="transport-bar">
              <div className="zoom-control">
                <span>Zoom</span>
                <input
                  max="1.8"
                  min="0.65"
                  onChange={(event) => setZoom(Number(event.target.value))}
                  step="0.01"
                  type="range"
                  value={zoom}
                />
              </div>

              <div className="transport-cluster">
                <button className="transport-button" onClick={() => jumpPlayhead(-1)} type="button">
                  |{'<'}
                </button>
                <button className="transport-button" onClick={() => jumpPlayhead(-0.5)} type="button">
                  {'<<'}
                </button>
                <button
                  className="transport-button transport-button--primary"
                  disabled={isExporting}
                  onClick={handleTransportToggle}
                  type="button"
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button className="transport-button" onClick={() => jumpPlayhead(0.5)} type="button">
                  {'>>'}
                </button>
                <button className="transport-button" onClick={() => jumpPlayhead(1)} type="button">
                  {'>'}|
                </button>
              </div>

              <div className="transport-summary">
                <span>{isExporting && exportState.detail ? exportState.detail : status}</span>
              </div>
            </div>
          </section>

          <section className="fx-panel">
            <div className="fx-rack">
              <div className="fx-rack__header">
                <strong>FX Layer Stack</strong>
                <span>
                  {effects.length
                    ? 'Imported from the .lvp session'
                    : 'Fallback rack until session effects are available'}
                </span>
              </div>

              <div className="fx-rack__devices">
                {fxDevices.map((device) => (
                  <button
                    key={device.id}
                    className={`fx-device ${selectedFx?.id === device.id ? 'fx-device--active' : ''}`}
                    onClick={() => setSelectedFxId(device.id)}
                    type="button"
                  >
                    <div
                      className="fx-device__badge"
                      style={{ backgroundColor: device.accent }}
                    />
                    <div>
                      <strong>{device.name}</strong>
                      <span>{device.subtitle}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="fx-inspector">
              <div className="fx-inspector__header">
                <strong>{selectedFx?.name ?? 'No device selected'}</strong>
                <span>{selectedTrack?.name ?? selectedClip?.label ?? 'No clip selected'}</span>
              </div>

              {selectedFx ? (
                <div className="fx-inspector__grid">
                  {selectedFx.parameters.map((parameter) => (
                    <div key={parameter.label} className="parameter-card">
                      <span>{parameter.label}</span>
                      <strong>{parameter.display}</strong>
                      <div className="parameter-card__meter">
                        <div
                          className="parameter-card__fill"
                          style={{
                            width: `${parameter.value * 100}%`,
                            backgroundColor: selectedFx.accent,
                          }}
                        />
                      </div>
                    </div>
                  ))}

                  <div className="inspector-note">
                    <strong>Dev Server Media Flow</strong>
                    <p>
                      `Open` uses the browser file picker, posts the `.lvp` contents to a Vite
                      dev endpoint, and registers the referenced media paths for streaming.
                      Playback then uses `/api/media/:id` URLs with byte-range streaming so the
                      browser can seek normally.
                    </p>
                    <p>
                      MediaBunny still runs in the client for metadata, thumbnails, and
                      waveforms. The dev server is only handling trusted disk access for this
                      local workflow.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="inspector-note">
                  <strong>No clip selected</strong>
                  <p>Open a session or import media to populate the rack and inspector.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
