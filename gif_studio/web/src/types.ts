export type MetricKey = 'pixel' | 'rms' | 'path' | 'flips'
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'smoothstep' | 'hold'
export type Mapping = 'timestep' | 'change'
export type FrameLayout = 'single' | 'grid3'
export type InspectorTab = 'timing' | 'appearance' | 'text' | 'export'

export interface MazeRecord {
  id: string
  index: number
  seed: number
  grid: string[]
  path: number[][]
  start: number[]
  stop: number[]
  pathLength: number
  turns: number
  span: number
  cachedRuns: number
  valid: boolean | null
  settleT: number | null
  activity: number
}

export interface RunMeta {
  id: string
  mazeSeed: number
  mazeIndex: number
  diffusionSeed: number
  valid: boolean
  settleT: number
  activity: number
  metrics: Record<MetricKey, number[]>
  elapsedSeconds: number
  shape: number[]
  device: string
  cached: boolean
  framesUrl: string
}

export interface ScanResult {
  index: number
  valid: boolean
  settleT: number
  activity: number
}

export interface ScanJob {
  id: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  done: number
  total: number
  results: ScanResult[]
  error: string | null
}

/** A point on the mapping curve: x is playback position, y is progress through the source. */
export interface Keypoint {
  id: string
  x: number
  y: number
  easing: Easing
}

export interface TimingConfig {
  frames: number
  fps: number
  mapping: Mapping
  metric: MetricKey
  sensitivity: number
  startHold: number
  endHold: number
}

export interface TextConfig {
  enabled: boolean
  template: string
  solvedTemplate: string
  failedTemplate: string
  family: 'sans' | 'mono' | 'serif'
  size: number
  weight: 'regular' | 'bold'
  color: string
  position: string
  offsetX: number
  offsetY: number
  padding: number
  background: string
  backgroundOpacity: number
  radius: number
  outline: number
  shadow: boolean
  margin: number
  opacity: number
  fadeInFrames: number
  fadeOutFrames: number
}

export interface AppearanceConfig {
  resolution: number
  openColor: string
  wallColor: string
  pathColor: string
  startColor: string
  goalColor: string
  borderCells: number
  background: string
  padTop: number
  padRight: number
  padBottom: number
  padLeft: number
  autoPad: boolean
  maskPrediction: boolean
  gamma: number
  layout: FrameLayout
  gridGap: number
}

/** One cell of the preview or filmstrip: a maze plus its 1,000-step run, if loaded. */
export interface PreviewTile {
  maze: MazeRecord | null
  frames: Uint8Array | null
}

export interface ExportConfig {
  format: 'gif' | 'mp4' | 'webm' | 'apng' | 'png-zip'
  quality: number
  loop: boolean
  colors: number
  dither: boolean
}

export interface ExportEntry {
  filename: string
  bytes: number
  modified: number
  url: string
}

export interface Health {
  ok: boolean
  device: string
  modelLoaded: boolean
  ffmpeg: boolean
  fonts: boolean
  timesteps: number
  gridSize: number
}
