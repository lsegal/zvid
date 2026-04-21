import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

type MediaKind = 'video' | 'audio'

type MediaItem = {
  id: string
  name: string
  kind: MediaKind
  durationSeconds: number
  width?: number
  height?: number
  hasAudio: boolean
  hasVideo: boolean
  previewUrl: string
}

type Lane = {
  id: string
  name: string
  colorIndex: number
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
  sourceOffsetSeconds: number
  tint: string
  accent: string
}

type SessionEffect = {
  id: string
  trackId: string
  effectName: string
  parameters: Array<{
    key: string
    value: string
    numericValue?: number
  }>
}

type VisualState = {
  opacity: number
  scale: number
  translateX: number
  translateY: number
  rotationDeg: number
  brightness: number
  contrast: number
  saturation: number
}

type ActiveClip = {
  clip: ArrangementClip
  media: MediaItem
  mediaTime: number
  isInBounds: boolean
  laneRank: number
  visual: VisualState
}

type CompositionPlayerProps = {
  mediaItems: MediaItem[]
  clips: ArrangementClip[]
  lanes: Lane[]
  effects: SessionEffect[]
  playheadQ: number
  bpm: number
  isPlaying: boolean
  isScrubbing: boolean
  isAudibleScrubbing: boolean
  canvasWidth: number
  canvasHeight: number
  playheadSeconds: number
  masterAudio?: MediaItem
}

export type CompositionPlayerHandle = {
  getCanvas(): HTMLCanvasElement | null
  renderFrameAt(playheadQ: number, playheadSeconds: number): Promise<void>
  restorePreviewSurface(playheadQ: number, playheadSeconds: number): Promise<void>
}

type WebGlResources = {
  gl: WebGLRenderingContext
  program: WebGLProgram
  positionBuffer: WebGLBuffer
  textureMap: Map<string, WebGLTexture>
  readyTextureIds: Set<string>
  uniforms: {
    position: number
    texture: WebGLUniformLocation | null
    coverScale: WebGLUniformLocation | null
    userScale: WebGLUniformLocation | null
    translate: WebGLUniformLocation | null
    rotation: WebGLUniformLocation | null
    opacity: WebGLUniformLocation | null
    brightness: WebGLUniformLocation | null
    contrast: WebGLUniformLocation | null
    saturation: WebGLUniformLocation | null
  }
}

const MAX_DRIFT_SECONDS = 0.18
const MEDIA_SEEK_TOLERANCE_SECONDS = 0.001
const MEDIA_SEEK_TIMEOUT_MS = 4000
const SCRUB_AUDIO_DRIFT_SECONDS = 0.035

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function quartersToSeconds(quarters: number, bpm: number) {
  return (quarters * 60) / bpm
}

function parseNumericValue(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeUnitValue(value: number, fallback = 1) {
  if (!Number.isFinite(value)) {
    return fallback
  }

  if (Math.abs(value) > 1.5 && Math.abs(value) <= 100) {
    return value / 100
  }

  return value
}

function resolveVisualState(effects: SessionEffect[], laneId: string): VisualState {
  const state: VisualState = {
    opacity: 1,
    scale: 1,
    translateX: 0,
    translateY: 0,
    rotationDeg: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
  }

  for (const effect of effects) {
    if (effect.trackId !== laneId && effect.trackId !== '__group_main') {
      continue
    }

    for (const parameter of effect.parameters) {
      const key = parameter.key.toLowerCase()
      const numeric = parameter.numericValue ?? parseNumericValue(parameter.value)
      if (numeric === undefined) {
        continue
      }

      if (key.includes('opacity') || key.includes('alpha') || key === 'mix') {
        state.opacity = clamp(normalizeUnitValue(numeric), 0, 1)
      } else if (key.includes('scale') || key.includes('zoom')) {
        state.scale = clamp(numeric > 4 ? numeric / 100 : numeric, 0.1, 8)
      } else if (key === 'x' || key.includes('positionx') || key.includes('translatex')) {
        state.translateX = clamp(numeric > 1 || numeric < -1 ? numeric / 100 : numeric, -2, 2)
      } else if (key === 'y' || key.includes('positiony') || key.includes('translatey')) {
        state.translateY = clamp(numeric > 1 || numeric < -1 ? numeric / 100 : numeric, -2, 2)
      } else if (key.includes('rotation') || key.includes('rotate')) {
        state.rotationDeg = numeric
      } else if (key.includes('brightness') || key.includes('exposure')) {
        state.brightness = clamp(normalizeUnitValue(numeric, 0), -1, 1)
      } else if (key.includes('contrast')) {
        state.contrast = clamp(numeric > 4 ? numeric / 100 : numeric, 0, 4)
      } else if (key.includes('saturation') || key.includes('sat')) {
        state.saturation = clamp(numeric > 4 ? numeric / 100 : numeric, 0, 4)
      }
    }
  }

  return state
}

function computeActiveClips(
  clips: ArrangementClip[],
  mediaById: Map<string, MediaItem>,
  playheadQ: number,
  bpm: number,
  lanePriority: Map<string, number>,
  effects: SessionEffect[],
) {
  const epsilon = 0.0001
  return clips
    .filter((clip) => {
      const media = clip.mediaId ? mediaById.get(clip.mediaId) : undefined
      if (!media?.previewUrl) {
        return false
      }

      const clipEndQ = clip.startQ + (clip.durationSeconds * bpm) / 60
      return playheadQ >= clip.startQ - epsilon && playheadQ < clipEndQ - epsilon
    })
    .sort((left, right) => {
      const laneDelta =
        (lanePriority.get(left.laneId) ?? Number.MAX_SAFE_INTEGER) -
        (lanePriority.get(right.laneId) ?? Number.MAX_SAFE_INTEGER)
      if (laneDelta !== 0) {
        return laneDelta
      }

      return left.startQ - right.startQ
    })
    .map<ActiveClip>((clip) => {
      const media = mediaById.get(clip.mediaId!)!
      const mediaTime = quartersToSeconds(playheadQ, bpm) + clip.sourceOffsetSeconds
      return {
        clip,
        media,
        mediaTime,
        isInBounds:
          media.durationSeconds > 0
            ? mediaTime >= 0 && mediaTime < media.durationSeconds - epsilon
            : mediaTime >= 0,
        laneRank: lanePriority.get(clip.laneId) ?? -1,
        visual: resolveVisualState(effects, clip.laneId),
      }
    })
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to allocate WebGL shader.')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown WebGL shader compile error.'
    gl.deleteShader(shader)
    throw new Error(message)
  }

  return shader
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 aPosition;
      varying vec2 vUv;

      uniform vec2 uCoverScale;
      uniform float uUserScale;
      uniform vec2 uTranslate;
      uniform float uRotation;

      void main() {
        vec2 position = aPosition * uCoverScale * uUserScale;
        float s = sin(uRotation);
        float c = cos(uRotation);
        position = mat2(c, -s, s, c) * position;
        position += uTranslate;
        gl_Position = vec4(position, 0.0, 1.0);
        vUv = aPosition * 0.5 + 0.5;
      }
    `,
  )

  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;

      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float uOpacity;
      uniform float uBrightness;
      uniform float uContrast;
      uniform float uSaturation;

      void main() {
        vec4 color = texture2D(uTexture, vec2(vUv.x, 1.0 - vUv.y));
        color.rgb += uBrightness;
        color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
        float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
        color.rgb = mix(vec3(luma), color.rgb, uSaturation);
        color.a *= uOpacity;
        gl_FragColor = color;
      }
    `,
  )

  const program = gl.createProgram()
  if (!program) {
    throw new Error('Failed to allocate WebGL program.')
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown WebGL link error.'
    gl.deleteProgram(program)
    throw new Error(message)
  }

  return program
}

function ensureWebGlResources(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  })
  if (!gl) {
    throw new Error('WebGL is unavailable in this runtime.')
  }

  const program = createProgram(gl)
  const positionBuffer = gl.createBuffer()
  if (!positionBuffer) {
    throw new Error('Failed to allocate WebGL position buffer.')
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]),
    gl.STATIC_DRAW,
  )

  const position = gl.getAttribLocation(program, 'aPosition')
  const uniforms = {
    position,
    texture: gl.getUniformLocation(program, 'uTexture'),
    coverScale: gl.getUniformLocation(program, 'uCoverScale'),
    userScale: gl.getUniformLocation(program, 'uUserScale'),
    translate: gl.getUniformLocation(program, 'uTranslate'),
    rotation: gl.getUniformLocation(program, 'uRotation'),
    opacity: gl.getUniformLocation(program, 'uOpacity'),
    brightness: gl.getUniformLocation(program, 'uBrightness'),
    contrast: gl.getUniformLocation(program, 'uContrast'),
    saturation: gl.getUniformLocation(program, 'uSaturation'),
  }

  gl.useProgram(program)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  return {
    gl,
    program,
    positionBuffer,
    textureMap: new Map<string, WebGLTexture>(),
    readyTextureIds: new Set<string>(),
    uniforms,
  } satisfies WebGlResources
}

function getOrCreateTexture(resources: WebGlResources, id: string) {
  const existing = resources.textureMap.get(id)
  if (existing) {
    return existing
  }

  const texture = resources.gl.createTexture()
  if (!texture) {
    throw new Error('Failed to allocate WebGL texture.')
  }

  resources.gl.bindTexture(resources.gl.TEXTURE_2D, texture)
  resources.gl.texParameteri(resources.gl.TEXTURE_2D, resources.gl.TEXTURE_WRAP_S, resources.gl.CLAMP_TO_EDGE)
  resources.gl.texParameteri(resources.gl.TEXTURE_2D, resources.gl.TEXTURE_WRAP_T, resources.gl.CLAMP_TO_EDGE)
  resources.gl.texParameteri(resources.gl.TEXTURE_2D, resources.gl.TEXTURE_MIN_FILTER, resources.gl.LINEAR)
  resources.gl.texParameteri(resources.gl.TEXTURE_2D, resources.gl.TEXTURE_MAG_FILTER, resources.gl.LINEAR)
  resources.textureMap.set(id, texture)
  return texture
}

function drawComposition(
  resources: WebGlResources,
  canvas: HTMLCanvasElement,
  activeClips: ActiveClip[],
  mediaRefs: Map<string, HTMLMediaElement>,
) {
  const { gl, uniforms } = resources
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clearColor(0.07, 0.08, 0.11, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)

  const canvasAspect = canvas.width / Math.max(1, canvas.height)
  const stackedClips =
    activeClips.length > 1
      ? [...activeClips].sort((left, right) => {
          if (right.laneRank !== left.laneRank) {
            return right.laneRank - left.laneRank
          }

          return left.clip.startQ - right.clip.startQ
        })
      : activeClips

  for (const [index, entry] of stackedClips.entries()) {
    if (!entry.isInBounds) {
      continue
    }

    const mediaElement = mediaRefs.get(entry.media.id)
    if (!(mediaElement instanceof HTMLVideoElement)) {
      continue
    }

    const texture = getOrCreateTexture(resources, entry.media.id)
    const hasDecodedFrame =
      mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      (mediaElement.videoWidth > 0 || Boolean(entry.media.width)) &&
      (mediaElement.videoHeight > 0 || Boolean(entry.media.height))

    if (hasDecodedFrame) {
      resources.readyTextureIds.add(entry.media.id)
    } else if (!resources.readyTextureIds.has(entry.media.id)) {
      continue
    }

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (hasDecodedFrame) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mediaElement)
    }

    const videoWidth = mediaElement.videoWidth || entry.media.width || canvas.width
    const videoHeight = mediaElement.videoHeight || entry.media.height || canvas.height
    const videoAspect = videoWidth / Math.max(1, videoHeight)
    const slotCount = Math.max(1, stackedClips.length)
    const slotHeight = 2 / slotCount
    const slotCenterY = 1 - slotHeight * (index + 0.5)
    const slotAspect = canvasAspect / slotCount
    const coverScale =
      videoAspect > slotAspect
        ? [videoAspect / Math.max(slotAspect, 0.0001), 1]
        : [1, slotAspect / Math.max(videoAspect, 0.0001)]
    const stackedScale =
      slotCount > 1
        ? [coverScale[0], coverScale[1] / slotCount]
        : videoAspect > canvasAspect
          ? [canvasAspect / Math.max(videoAspect, 0.0001), 1]
          : [1, videoAspect / Math.max(canvasAspect, 0.0001)]

    gl.uniform1i(uniforms.texture, 0)
    gl.uniform2f(uniforms.coverScale, stackedScale[0], stackedScale[1])
    gl.uniform1f(uniforms.userScale, entry.visual.scale)
    gl.uniform2f(
      uniforms.translate,
      entry.visual.translateX,
      slotCount > 1 ? slotCenterY + entry.visual.translateY * (1 / slotCount) : entry.visual.translateY,
    )
    gl.uniform1f(uniforms.rotation, (entry.visual.rotationDeg * Math.PI) / 180)
    gl.uniform1f(uniforms.opacity, entry.visual.opacity)
    gl.uniform1f(uniforms.brightness, entry.visual.brightness)
    gl.uniform1f(uniforms.contrast, entry.visual.contrast)
    gl.uniform1f(uniforms.saturation, entry.visual.saturation)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}

function syncCanvasSurface(
  canvas: HTMLCanvasElement,
  canvasWidth: number,
  canvasHeight: number,
  pixelRatio: number,
) {
  const nextWidth = Math.max(1, Math.floor(canvasWidth * pixelRatio))
  const nextHeight = Math.max(1, Math.floor(canvasHeight * pixelRatio))
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth
    canvas.height = nextHeight
  }

  canvas.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`
}

function seekMediaElement(element: HTMLMediaElement, targetSeconds: number) {
  const clampedTarget = Math.max(0, targetSeconds)
  const drift = Math.abs(element.currentTime - clampedTarget)
  if (drift <= MEDIA_SEEK_TOLERANCE_SECONDS) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    let settled = false
    let timeoutId = 0

    const settle = () => {
      if (settled) {
        return
      }

      settled = true
      window.clearTimeout(timeoutId)
      element.removeEventListener('seeked', settle)
      element.removeEventListener('error', settle)
      element.removeEventListener('loadeddata', settle)
      resolve()
    }

    timeoutId = window.setTimeout(settle, MEDIA_SEEK_TIMEOUT_MS)
    element.addEventListener('seeked', settle, { once: true })
    element.addEventListener('error', settle, { once: true })
    element.addEventListener('loadeddata', settle, { once: true })

    try {
      element.pause()
      element.currentTime = clampedTarget
    } catch {
      settle()
    }
  })
}

export const CompositionPlayer = forwardRef<CompositionPlayerHandle, CompositionPlayerProps>(function CompositionPlayer({
  mediaItems,
  clips,
  lanes,
  effects,
  playheadQ,
  bpm,
  isPlaying,
  isScrubbing,
  isAudibleScrubbing,
  canvasWidth,
  canvasHeight,
  playheadSeconds,
  masterAudio,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRefs = useRef(new Map<string, HTMLMediaElement>())
  const resourcesRef = useRef<WebGlResources | null>(null)
  const playbackFrameRef = useRef<number>(0)
  const renderRequestRef = useRef<number>(0)
  const activeClipsRef = useRef<ActiveClip[]>([])

  const mediaById = useMemo(() => new Map(mediaItems.map((item) => [item.id, item])), [mediaItems])
  const lanePriority = useMemo(() => new Map(lanes.map((lane, index) => [lane.id, index])), [lanes])
  const activeClips = useMemo(
    () => computeActiveClips(clips, mediaById, playheadQ, bpm, lanePriority, effects),
    [clips, mediaById, playheadQ, bpm, lanePriority, effects],
  )
  activeClipsRef.current = activeClips

  function drawCurrentFrame(pixelRatio: number) {
    const canvas = canvasRef.current
    const resources = resourcesRef.current
    if (!canvas || !resources) {
      return
    }

    syncCanvasSurface(canvas, canvasWidth, canvasHeight, pixelRatio)
    drawComposition(resources, canvas, activeClipsRef.current, mediaRefs.current)
  }

  function scheduleDraw(pixelRatio = window.devicePixelRatio || 1) {
    if (renderRequestRef.current) {
      window.cancelAnimationFrame(renderRequestRef.current)
    }

    renderRequestRef.current = window.requestAnimationFrame(() => {
      renderRequestRef.current = 0
      drawCurrentFrame(pixelRatio)
    })
  }

  const renderFrameAt = async (nextPlayheadQ: number, nextPlayheadSeconds: number, pixelRatio: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    if (!resourcesRef.current) {
      resourcesRef.current = ensureWebGlResources(canvas)
    }

    syncCanvasSurface(canvas, canvasWidth, canvasHeight, pixelRatio)

    const nextActiveClips = computeActiveClips(
      clips,
      mediaById,
      nextPlayheadQ,
      bpm,
      lanePriority,
      effects,
    )
    console.info('[zvid] composition:renderFrameAt', {
      playheadQ: nextPlayheadQ,
      playheadSeconds: nextPlayheadSeconds,
      activeClips: nextActiveClips.length,
    })
    const pendingSeeks = new Map<string, Promise<void>>()

    for (const entry of nextActiveClips) {
      if (!entry.isInBounds) {
        continue
      }

      const mediaElement = mediaRefs.current.get(entry.media.id)
      if (!(mediaElement instanceof HTMLVideoElement)) {
        continue
      }

      console.info('[zvid] composition:seekMedia', {
        mediaId: entry.media.id,
        mediaTime: entry.mediaTime,
        readyState: mediaElement.readyState,
        currentTime: mediaElement.currentTime,
      })
      pendingSeeks.set(entry.media.id, seekMediaElement(mediaElement, entry.mediaTime))
    }

    if (pendingSeeks.size) {
      await Promise.all(pendingSeeks.values())
      console.info('[zvid] composition:seekMedia:complete', {
        pendingSeeks: pendingSeeks.size,
      })
    }

    if (audioRef.current && masterAudio?.previewUrl) {
      audioRef.current.pause()
      audioRef.current.currentTime = nextPlayheadSeconds
    }

    drawComposition(resourcesRef.current, canvas, nextActiveClips, mediaRefs.current)
  }

  useImperativeHandle(
    ref,
    () => ({
      getCanvas: () => canvasRef.current,
      renderFrameAt: (nextPlayheadQ, nextPlayheadSeconds) =>
        renderFrameAt(nextPlayheadQ, nextPlayheadSeconds, 1),
      restorePreviewSurface: (nextPlayheadQ, nextPlayheadSeconds) =>
        renderFrameAt(nextPlayheadQ, nextPlayheadSeconds, window.devicePixelRatio || 1),
    }),
    [bpm, canvasHeight, canvasWidth, clips, effects, lanePriority, masterAudio?.previewUrl, mediaById],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    if (!resourcesRef.current) {
      resourcesRef.current = ensureWebGlResources(canvas)
    }

    return () => {
      if (playbackFrameRef.current) {
        window.cancelAnimationFrame(playbackFrameRef.current)
      }
      if (renderRequestRef.current) {
        window.cancelAnimationFrame(renderRequestRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !resourcesRef.current) {
      return
    }

    const pixelRatio = window.devicePixelRatio || 1

    const render = () => {
      if (!canvasRef.current || !resourcesRef.current) {
        return
      }

      drawCurrentFrame(pixelRatio)
      if (isPlaying) {
        playbackFrameRef.current = window.requestAnimationFrame(render)
      }
    }

    render()

    return () => {
      if (playbackFrameRef.current) {
        window.cancelAnimationFrame(playbackFrameRef.current)
      }
    }
  }, [activeClips, canvasHeight, canvasWidth, isPlaying])

  useEffect(() => {
    const removeListeners: Array<() => void> = []

    for (const item of mediaItems) {
      const element = mediaRefs.current.get(item.id)
      if (!element) {
        continue
      }

      const activeEntry = activeClips.find((entry) => entry.media.id === item.id)
      if (!activeEntry) {
        if (!element.paused) {
          element.pause()
        }
        continue
      }

      if (!activeEntry.isInBounds) {
        if (!element.paused) {
          element.pause()
        }
        continue
      }

      if (element instanceof HTMLVideoElement) {
        const handleFrameReady = () => scheduleDraw()
        element.addEventListener('seeked', handleFrameReady)
        element.addEventListener('loadeddata', handleFrameReady)
        removeListeners.push(() => {
          element.removeEventListener('seeked', handleFrameReady)
          element.removeEventListener('loadeddata', handleFrameReady)
        })
      }

      const drift = Math.abs(element.currentTime - activeEntry.mediaTime)
      if (!isPlaying || isScrubbing || drift > MAX_DRIFT_SECONDS) {
        element.currentTime = activeEntry.mediaTime
      }

      const shouldPlay = item.kind === 'video' ? isPlaying : isPlaying || isAudibleScrubbing
      if (shouldPlay) {
        element.play().catch(() => {})
      } else if (!element.paused) {
        element.pause()
      }
    }

    return () => {
      for (const removeListener of removeListeners) {
        removeListener()
      }
    }
  }, [activeClips, isAudibleScrubbing, isPlaying, isScrubbing, mediaItems])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !masterAudio?.previewUrl) {
      return
    }

    const shouldPlay = isPlaying || isAudibleScrubbing
    const driftTolerance = isAudibleScrubbing ? SCRUB_AUDIO_DRIFT_SECONDS : MAX_DRIFT_SECONDS
    const drift = Math.abs(audio.currentTime - playheadSeconds)
    if (!shouldPlay || drift > driftTolerance) {
      audio.currentTime = playheadSeconds
    }

    if (shouldPlay) {
      audio.play().catch(() => {})
    } else if (!audio.paused) {
      audio.pause()
    }
  }, [isAudibleScrubbing, isPlaying, masterAudio?.previewUrl, playheadSeconds])

  return (
    <div className="composition-player">
      <canvas className="composition-player__canvas" ref={canvasRef} />
      <div className="composition-player__media-bin" aria-hidden="true">
        {mediaItems.map((item) =>
          item.kind === 'video' ? (
            <video
              key={item.id}
              crossOrigin="anonymous"
              muted
              playsInline
              preload="auto"
              ref={(node) => {
                if (node) {
                  mediaRefs.current.set(item.id, node)
                } else {
                  mediaRefs.current.delete(item.id)
                }
              }}
              src={item.previewUrl}
            />
          ) : item.kind === 'audio' ? (
            <audio
              key={item.id}
              crossOrigin="anonymous"
              preload="auto"
              ref={(node) => {
                if (node) {
                  mediaRefs.current.set(item.id, node)
                } else {
                  mediaRefs.current.delete(item.id)
                }
              }}
              src={item.previewUrl}
            />
          ) : null,
        )}
        {masterAudio?.previewUrl ? (
          <audio crossOrigin="anonymous" preload="auto" ref={audioRef} src={masterAudio.previewUrl} />
        ) : null}
      </div>
    </div>
  )
})
