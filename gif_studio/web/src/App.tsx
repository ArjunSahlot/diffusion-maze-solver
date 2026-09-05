import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert'
import Check from 'lucide-react/dist/esm/icons/check'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import Cpu from 'lucide-react/dist/esm/icons/cpu'
import Download from 'lucide-react/dist/esm/icons/download'
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle'
import Menu from 'lucide-react/dist/esm/icons/menu'
import Redo2 from 'lucide-react/dist/esm/icons/redo-2'
import ScanEye from 'lucide-react/dist/esm/icons/scan-eye'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2'
import X from 'lucide-react/dist/esm/icons/x'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inspector } from './components/Inspector'
import { MazeBrowser } from './components/MazeBrowser'
import { MazePreview, type ExactStatus } from './components/MazePreview'
import { PlaybackBar } from './components/PlaybackBar'
import { TimelineEditor } from './components/TimelineEditor'
import { api, loadExportFonts } from './lib/api'
import { withPad } from './lib/draw'
import { REGION_NAMES, mazeStats, regionOf } from './lib/mazeStats'
import {
  changeTable, curveSchedule, frameChange, insertKeypoint, linearKeypoints, makeMapper,
} from './lib/timeline'
import type {
  AppearanceConfig, ExportConfig, ExportEntry, FrameLayout, Health, InspectorTab, Keypoint,
  Mapping, MazeRecord, PreviewTile, RunMeta, ScanJob, TextConfig, TimingConfig,
} from './types'

const DEFAULT_APPEARANCE: AppearanceConfig = {
  resolution: 512,
  openColor: '#ffffff',
  wallColor: '#212128',
  pathColor: '#4f8ff7',
  startColor: '#2ecc70',
  goalColor: '#e84d3d',
  borderCells: 1,
  background: '#0d0f11',
  padTop: 0,
  padRight: 0,
  padBottom: 0,
  padLeft: 0,
  autoPad: true,
  maskPrediction: false,
  gamma: 1,
  layout: 'single',
  gridGap: 6,
}

const DEFAULT_TEXT: TextConfig = {
  enabled: true,
  template: 't = {t}',
  solvedTemplate: 'SOLVED',
  failedTemplate: 'FAILED',
  family: 'mono',
  size: 28,
  weight: 'bold',
  color: '#ffffff',
  position: 'top-left',
  offsetX: 0,
  offsetY: 0,
  padding: 10,
  background: '#090a0c',
  backgroundOpacity: 0,
  radius: 6,
  outline: 0,
  shadow: true,
  margin: 12,
  opacity: 1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
}

const DEFAULT_TIMING: TimingConfig = {
  frames: 100,
  fps: 20,
  mapping: 'change',
  metric: 'pixel',
  sensitivity: 1,
  startHold: 250,
  endHold: 1000,
}

const DEFAULT_EXPORT: ExportConfig = { format: 'gif', quality: 90, loop: true, colors: 128, dither: false }
const STORAGE_KEY = 'denoise-studio:settings:v2'

interface HistoryEntry { points: Keypoint[] }
interface StoredRun { run: RunMeta; frames: Uint8Array }

const emptySlots = (): (MazeRecord | null)[] => Array.from({ length: 9 }, () => null)

function averageSeries(series: number[][]): number[] | undefined {
  if (!series.length) return undefined
  const length = series[0].length
  return Array.from({ length }, (_, index) => (
    series.reduce((sum, item) => sum + (item[index] ?? 0), 0) / series.length
  ))
}

function runIdFor(maze: MazeRecord, diffusionSeed: number) {
  return `s${maze.seed}-m${maze.index}-d${diffusionSeed}`
}

function readSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) as {
      timing?: TimingConfig; appearance?: AppearanceConfig; text?: TextConfig; exportConfig?: ExportConfig
    } : {}
  } catch {
    return {}
  }
}

function App() {
  const saved = useMemo(readSettings, [])
  const [health, setHealth] = useState<Health | null>(null)
  const [mazes, setMazes] = useState<MazeRecord[]>([])
  const [seed, setSeed] = useState(482917)
  const [count, setCount] = useState(96)
  const [selected, setSelected] = useState<MazeRecord | null>(null)
  const [slots, setSlots] = useState<(MazeRecord | null)[]>(emptySlots)
  const [slotFocus, setSlotFocus] = useState(0)
  const [runStore, setRunStore] = useState<Record<string, StoredRun>>({})
  const [diffusionSeed, setDiffusionSeed] = useState(7)
  const [loadingMazes, setLoadingMazes] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null)
  const [scan, setScan] = useState<ScanJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [previewLoop, setPreviewLoop] = useState(true)
  const [exactMode, setExactMode] = useState(false)
  const [exactUrl, setExactUrl] = useState<string | null>(null)
  const [exactStatus, setExactStatus] = useState<ExactStatus>('off')
  const [tab, setTab] = useState<InspectorTab>('timing')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [timing, setTiming] = useState<TimingConfig>({ ...DEFAULT_TIMING, ...saved.timing })
  const [appearance, setAppearance] = useState<AppearanceConfig>({ ...DEFAULT_APPEARANCE, ...saved.appearance })
  const [text, setText] = useState<TextConfig>(() => {
    const merged = { ...DEFAULT_TEXT, ...saved.text }
    if (!merged.solvedTemplate) merged.solvedTemplate = DEFAULT_TEXT.solvedTemplate
    if (!merged.failedTemplate) merged.failedTemplate = DEFAULT_TEXT.failedTemplate
    return merged
  })
  const [exportConfig, setExportConfig] = useState<ExportConfig>({ ...DEFAULT_EXPORT, ...saved.exportConfig })
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<ExportEntry | null>(null)
  const [exportHistory, setExportHistory] = useState<ExportEntry[]>([])
  const [points, setPointsState] = useState<Keypoint[]>(linearKeypoints)
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null)
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])
  const editStart = useRef<HistoryEntry | null>(null)
  const latest = useRef(points)
  const loadedOnce = useRef(false)
  const storeRef = useRef(runStore)
  storeRef.current = runStore

  const setPoints = useCallback((next: Keypoint[]) => {
    latest.current = next
    setPointsState(next)
  }, [])

  const beginEdit = useCallback(() => {
    if (!editStart.current) editStart.current = { points: latest.current.map(point => ({ ...point })) }
  }, [])

  const endEdit = useCallback(() => {
    const before = editStart.current
    editStart.current = null
    if (!before || JSON.stringify(before.points) === JSON.stringify(latest.current)) return
    setPast(history => [...history.slice(-49), before])
    setFuture([])
  }, [])

  const commitPoints = useCallback((next: Keypoint[]) => {
    setPast(history => [...history.slice(-49), { points: latest.current.map(point => ({ ...point })) }])
    setFuture([])
    latest.current = next
    setPointsState(next)
  }, [])

  const undo = useCallback(() => {
    const previous = past.at(-1)
    if (!previous) return
    setFuture(entries => [{ points: latest.current.map(point => ({ ...point })) }, ...entries].slice(0, 50))
    setPast(entries => entries.slice(0, -1))
    latest.current = previous.points
    setPointsState(previous.points)
  }, [past])

  const redo = useCallback(() => {
    const next = future[0]
    if (!next) return
    setPast(entries => [...entries.slice(-49), { points: latest.current.map(point => ({ ...point })) }])
    setFuture(entries => entries.slice(1))
    latest.current = next.points
    setPointsState(next.points)
  }, [future])

  const refreshMazes = useCallback(async (nextSeed = seed, nextCount = count) => {
    setLoadingMazes(true)
    try {
      const result = await api.mazes(nextSeed, nextCount, diffusionSeed)
      setMazes(result.mazes)
      const sync = (maze: MazeRecord | null) => maze ? result.mazes.find(item => item.id === maze.id) ?? maze : null
      setSelected(current => sync(current) ?? result.mazes[0] ?? null)
      setSlots(current => current.map(sync))
      return result.mazes
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not generate mazes.')
      return []
    } finally {
      setLoadingMazes(false)
    }
  }, [count, diffusionSeed, seed])

  const generate = useCallback(async () => {
    setError(null)
    setRunStore({})
    setFrame(0)
    setPlaying(false)
    setSelected(null)
    setSlots(emptySlots())
    const next = await refreshMazes()
    setSelected(next[0] ?? null)
    if (appearance.layout === 'grid3') {
      setSlots(emptySlots().map((_, index) => index === 0 ? next[0] ?? null : null))
    }
  }, [appearance.layout, refreshMazes])

  useEffect(() => {
    if (loadedOnce.current) return
    loadedOnce.current = true
    void loadExportFonts().catch(() => setError('Preview fonts could not load; the counter preview may not match the export.'))
    void Promise.all([
      api.health().then(setHealth),
      api.mazes(seed, count, diffusionSeed).then(result => {
        setMazes(result.mazes)
        setSelected(result.mazes[0] ?? null)
      }),
      api.exports().then(result => setExportHistory(result.exports)),
    ]).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not start Denoise Studio.'))
  }, [count, diffusionSeed, seed])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ timing, appearance, text, exportConfig }))
    } catch {
      // Preferences are a convenience; private browsing can disable storage.
    }
  }, [appearance, exportConfig, text, timing])

  useEffect(() => {
    setRunStore({})
  }, [diffusionSeed])

  const gridMode = appearance.layout === 'grid3'
  const renderAppearance = useMemo(() => withPad(appearance, text), [appearance, text])
  const selectedStats = selected ? mazeStats(selected) : null
  const filledSlots = useMemo(() => slots.filter((maze): maze is MazeRecord => Boolean(maze)), [slots])
  const activeMazes = useMemo(
    () => gridMode ? filledSlots : (selected ? [selected] : []),
    [filledSlots, gridMode, selected],
  )
  const activeRuns = useMemo(
    () => activeMazes.map(maze => runStore[maze.id]?.run).filter((item): item is RunMeta => Boolean(item)),
    [activeMazes, runStore],
  )
  const tiles = useMemo<PreviewTile[]>(() => {
    if (!gridMode) return [{ maze: selected, frames: selected ? runStore[selected.id]?.frames ?? null : null }]
    return slots.map(maze => ({ maze, frames: maze ? runStore[maze.id]?.frames ?? null : null }))
  }, [gridMode, runStore, selected, slots])
  const exportIds = useMemo(() => {
    if (!gridMode) {
      const id = selected ? runStore[selected.id]?.run.id : undefined
      return id ? [id] : []
    }
    return slots.map(maze => maze ? runStore[maze.id]?.run.id ?? '' : '')
  }, [gridMode, runStore, selected, slots])
  const readyCount = activeMazes.filter(maze => runStore[maze.id]).length
  const neededCount = activeMazes.length
  const canExport = neededCount > 0 && readyCount === neededCount
  const selectedEntry = selected ? runStore[selected.id] : undefined
  const run = selectedEntry?.run ?? activeRuns[0] ?? null
  const metric = useMemo(
    () => averageSeries(activeRuns.map(item => item.metrics[timing.metric]).filter((item): item is number[] => Boolean(item?.length))),
    [activeRuns, timing.metric],
  )
  const table = useMemo(() => changeTable(metric, timing.sensitivity), [metric, timing.sensitivity])
  const mapper = useMemo(() => makeMapper(timing.mapping, table), [table, timing.mapping])
  const schedule = useMemo(() => curveSchedule(points, timing.frames, mapper), [mapper, points, timing.frames])
  const change = useMemo(() => frameChange(schedule, metric), [metric, schedule])
  const timestep = schedule[Math.min(frame, schedule.length - 1)] ?? 999

  const rememberRun = useCallback(async (maze: MazeRecord, result: RunMeta) => {
    const frames = await api.frames(result.framesUrl)
    const next = { ...maze, cachedRuns: Math.max(1, maze.cachedRuns), valid: result.valid, settleT: result.settleT }
    setRunStore(store => ({ ...store, [maze.id]: { run: result, frames } }))
    setHealth(value => value ? { ...value, modelLoaded: true } : value)
    setMazes(items => items.map(item => item.id === maze.id ? next : item))
    setSlots(current => current.map(slot => slot?.id === maze.id ? next : slot))
    setSelected(current => current?.id === maze.id ? next : current)
  }, [])

  const analyze = useCallback(async (force = false) => {
    const targets = (gridMode ? filledSlots : (selected ? [selected] : []))
      .filter(maze => force || runStore[maze.id]?.run.id !== runIdFor(maze, diffusionSeed))
    if (!targets.length) return
    setAnalyzing(true)
    setPlaying(false)
    setError(null)
    setAnalyzeProgress({ done: 0, total: targets.length })
    try {
      for (const [index, maze] of targets.entries()) {
        const result = await api.run(maze.seed, maze.index, diffusionSeed, force)
        await rememberRun(maze, result)
        setAnalyzeProgress({ done: index + 1, total: targets.length })
      }
      setFrame(0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Model analysis failed.')
    } finally {
      setAnalyzing(false)
      setAnalyzeProgress(null)
    }
  }, [diffusionSeed, filledSlots, gridMode, rememberRun, runStore, selected])

  // Cached runs load as soon as a maze is picked; only unseen mazes need Analyze.
  useEffect(() => {
    const targets = (gridMode ? slots.filter((maze): maze is MazeRecord => Boolean(maze)) : (selected ? [selected] : []))
      .filter(maze => maze.cachedRuns && storeRef.current[maze.id]?.run.id !== runIdFor(maze, diffusionSeed))
    if (!targets.length) return
    let stale = false
    void (async () => {
      for (const maze of targets) {
        try {
          const result = await api.run(maze.seed, maze.index, diffusionSeed)
          if (stale) return
          await rememberRun(maze, result)
        } catch {
          // A missing cache entry just leaves the Analyze button available.
        }
      }
    })()
    return () => { stale = true }
  }, [diffusionSeed, gridMode, rememberRun, selected, slots])

  const startScan = useCallback(async () => {
    setError(null)
    try {
      const { jobId } = await api.startScan(seed, mazes.length || count, diffusionSeed, 32, false)
      setScan({ id: jobId, status: 'running', done: 0, total: mazes.length || count, results: [], error: null })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the scan.')
    }
  }, [count, diffusionSeed, mazes.length, seed])

  useEffect(() => {
    if (scan?.status !== 'running') return
    const timer = window.setInterval(async () => {
      try {
        const update = await api.scan(scan.id)
        setScan(update)
        if (update.status !== 'running') {
          window.clearInterval(timer)
          await refreshMazes()
          if (update.status === 'error' && update.error) setError(update.error)
        }
      } catch {
        window.clearInterval(timer)
      }
    }, 700)
    return () => window.clearInterval(timer)
  }, [refreshMazes, scan?.id, scan?.status])

  const updateTiming = useCallback((patch: Partial<TimingConfig>) => {
    setTiming(value => ({ ...value, ...patch }))
    if (patch.frames !== undefined) setFrame(value => Math.min(value, patch.frames! - 1))
  }, [])

  const setMapping = useCallback((mapping: Mapping) => {
    if (mapping === 'change' && !table) {
      setError('Analyze the selected maze(s) first: equal change needs a real model run to measure.')
      return
    }
    updateTiming({ mapping })
  }, [table, updateTiming])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setFrame(current => {
        if (current < timing.frames - 1) return current + 1
        if (previewLoop) return 0
        setPlaying(false)
        return current
      })
    }, 1000 / timing.fps)
    return () => window.clearInterval(timer)
  }, [playing, previewLoop, timing.fps, timing.frames])

  // Eye preview: drop the last export frame as soon as inputs change so the live
  // canvas shows through, then overlay a fresh Pillow render (and GIF palette).
  const exportIdKey = exportIds.join('|')
  useEffect(() => {
    setExactUrl(current => { if (current) URL.revokeObjectURL(current); return null })
    if (!exactMode) {
      setExactStatus('off')
      return
    }
    if (!canExport) {
      setExactStatus('error')
      return
    }
    if (playing) {
      setExactStatus('off')
      return
    }
    setExactStatus('loading')
    let stale = false
    let created: string | null = null
    const timer = window.setTimeout(() => {
      void api.frameUrl(exportIds, timestep, frame, timing.frames, timing.fps, renderAppearance, text, exportConfig)
        .then(url => {
          created = url
          if (stale) {
            URL.revokeObjectURL(url)
            return
          }
          setExactUrl(url)
          setExactStatus('ready')
        })
        .catch(() => { if (!stale) setExactStatus('error') })
    }, 80)
    return () => {
      stale = true
      window.clearTimeout(timer)
      if (created) URL.revokeObjectURL(created)
    }
  }, [canExport, exactMode, exportConfig, exportIdKey, exportIds, frame, playing, renderAppearance, text, timestep, timing.fps, timing.frames])

  const addPoint = useCallback(() => {
    const x = frame / Math.max(timing.frames - 1, 1)
    if (points.some(point => Math.abs(point.x - x) < 0.001)) return
    const next = insertKeypoint(points, x)
    commitPoints(next)
    setSelectedPoint(next.find(point => Math.abs(point.x - x) < 0.001)?.id ?? null)
  }, [commitPoints, frame, points, timing.frames])

  const deletePoint = useCallback(() => {
    const index = points.findIndex(point => point.id === selectedPoint)
    if (index <= 0 || index >= points.length - 1) return
    commitPoints(points.filter(point => point.id !== selectedPoint))
    setSelectedPoint(points[index - 1].id)
  }, [commitPoints, points, selectedPoint])

  const resetCurve = useCallback(() => {
    const next = linearKeypoints()
    commitPoints(next)
    setSelectedPoint(next[0].id)
  }, [commitPoints])

  const selectMaze = useCallback((maze: MazeRecord) => {
    setPlaying(false)
    setFrame(0)
    if (!gridMode) {
      setSelected(maze)
      return
    }
    setSlots(current => {
      const existing = current.findIndex(item => item?.id === maze.id)
      if (existing >= 0) {
        const next = [...current]
        next[existing] = null
        const leftover = next.find(item => item)
        setSelected(leftover ?? maze)
        return next
      }
      const next = [...current]
      const empty = next.findIndex(item => !item)
      const target = empty >= 0 ? empty : slotFocus
      next[target] = maze
      setSlotFocus(target < 8 ? target + 1 : target)
      setSelected(maze)
      return next
    })
  }, [gridMode, slotFocus])

  const fillGrid = useCallback((mazes: MazeRecord[]) => {
    const next = emptySlots()
    mazes.slice(0, 9).forEach((maze, index) => { next[index] = maze })
    setSlots(next)
    setSelected(mazes[0] ?? null)
    setSlotFocus(Math.min(mazes.length, 8))
    setFrame(0)
    setPlaying(false)
  }, [])

  const setLayout = useCallback((layout: FrameLayout) => {
    setAppearance(value => ({ ...value, layout }))
    if (layout === 'grid3') {
      setSlots(current => current.some(Boolean) ? current : emptySlots().map((_, index) => index === 0 ? selected : null))
    }
  }, [selected])

  const createExport = useCallback(async () => {
    if (!canExport || !exportIds.some(Boolean)) return
    setExporting(true)
    setError(null)
    try {
      const result = await api.export(exportIds, schedule, timing, renderAppearance, text, exportConfig)
      setExportResult(result)
      setExportHistory((await api.exports()).exports)
      const link = document.createElement('a')
      link.href = result.url
      link.download = result.filename
      link.click()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }, [canExport, exportConfig, exportIds, renderAppearance, schedule, text, timing])

  const removeExport = useCallback(async (filename: string) => {
    try {
      await api.deleteExport(filename)
      setExportResult(current => current?.filename === filename ? null : current)
      setExportHistory((await api.exports()).exports)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete that file.')
    }
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.code === 'Space') { event.preventDefault(); setPlaying(value => !value) }
      if (event.key === 'ArrowLeft') setFrame(value => Math.max(0, value - 1))
      if (event.key === 'ArrowRight') setFrame(value => Math.min(timing.frames - 1, value + 1))
      if (event.key.toLowerCase() === 'k') addPoint()
      if (event.key === 'Delete' || event.key === 'Backspace') deletePoint()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [addPoint, deletePoint, redo, timing.frames, undo])

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'} ${inspectorOpen ? '' : 'inspector-closed'}`}>
      <header className="topbar">
        <button type="button" className="icon-button mobile-menu" onClick={() => setSidebarOpen(value => !value)} title="Toggle maze browser"><Menu size={18} /></button>
        <div className="brand"><span className="brand-mark"><Sparkles size={15} /></span><strong>Denoise Studio</strong></div>
        <span className="save-state" title="Look, text, timing and export settings stay in this browser.">Autosaved</span>
        <div className="topbar-spacer" />
        <div className="history-actions">
          <button type="button" onClick={undo} disabled={!past.length} title="Undo curve edit (Ctrl/Cmd Z)"><Undo2 size={15} /> Undo</button>
          <button type="button" onClick={redo} disabled={!future.length} title="Redo curve edit (Ctrl/Cmd Shift Z)"><Redo2 size={15} /> Redo</button>
        </div>
        <button type="button" className="button button--primary export-top" onClick={() => { setTab('export'); setInspectorOpen(true) }}><Download size={15} /> Export <ChevronDown size={13} /></button>
      </header>

      <div className="workspace">
        <MazeBrowser
          mazes={mazes} selected={selected} pickedIds={gridMode ? slots.map(maze => maze?.id ?? null) : [selected?.id ?? null]}
          layout={appearance.layout} seed={seed} count={count} loading={loadingMazes} scan={scan}
          onSeed={setSeed} onCount={value => { setCount(value); void refreshMazes(seed, value) }}
          onGenerate={() => void generate()} onSelect={selectMaze} onFillGrid={fillGrid}
          onScan={() => void startScan()} onCancelScan={() => { if (scan) void api.cancelScan(scan.id) }}
        />

        <main className="editor">
          <section className="preview-region">
            <div className="runbar">
              <div className="layout-picks layout-picks--runbar" title="Single maze or nine mazes on one timeline">
                <button type="button" className={!gridMode ? 'is-on' : ''} onClick={() => setLayout('single')}>1×1</button>
                <button type="button" className={gridMode ? 'is-on' : ''} onClick={() => setLayout('grid3')}>3×3</button>
              </div>
              {gridMode ? (
                <div className="grid-slots" title="Click a slot, then a maze. Click a filled maze in the gallery to remove it.">
                  {slots.map((maze, index) => (
                    <button
                      key={index}
                      type="button"
                      className={`${maze ? 'is-filled' : ''} ${slotFocus === index ? 'is-focus' : ''}`}
                      onClick={() => {
                        setSlotFocus(index)
                        if (maze) setSelected(maze)
                      }}
                    >
                      {maze ? String(maze.index + 1) : index + 1}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="runbar__maze">
                <span>{gridMode ? `3×3 · ${filledSlots.length}/9` : 'Selected maze'}</span>
                <strong>#{selected ? String(selected.index + 1).padStart(3, '0') : '—'}</strong>
                {selected && selectedStats ? (
                  <small>
                    {REGION_NAMES[regionOf(selected.start)]} → {REGION_NAMES[regionOf(selected.stop)]}
                    {' · '}{selected.pathLength} cells · {selected.turns} turns
                    {' · '}{selectedStats.decisions ? `${selectedStats.decisions} decisions` : 'corridor only'}
                  </small>
                ) : null}
              </div>
              <label className="diffusion-seed" title="Changes the random noise the run starts from, so the same maze can be solved a different way.">
                <span>Diffusion seed</span>
                <input type="number" min={0} value={diffusionSeed} onChange={event => setDiffusionSeed(Number(event.target.value))} onBlur={() => void refreshMazes()} />
              </label>
              <button type="button" className="button button--analyze" onClick={() => void analyze(readyCount === neededCount && neededCount > 0)} disabled={!neededCount || analyzing}>
                {analyzing ? <LoaderCircle size={15} className="spin" /> : <Cpu size={15} />}
                {analyzing
                  ? (analyzeProgress ? `Running ${analyzeProgress.done}/${analyzeProgress.total}…` : 'Running 1,000 steps…')
                  : gridMode
                    ? (readyCount < neededCount ? `Analyze ${neededCount - readyCount}` : 'Rerun 3×3')
                    : run ? 'Rerun model' : 'Analyze model run'}
              </button>
              <button
                type="button"
                className={`icon-button exact-toggle ${exactMode ? 'is-active' : ''} ${exactStatus === 'loading' ? 'is-loading' : ''}`}
                onClick={() => setExactMode(value => !value)}
                disabled={!canExport}
                title="Overlay this frame as the exporter renders it — Pillow, DejaVu, and the GIF palette when the format is GIF. Play uses the live canvas."
              >
                {exactStatus === 'loading' ? <LoaderCircle size={15} className="spin" /> : <ScanEye size={15} />}
              </button>
              {activeRuns.length ? (
                <span className={`validity ${activeRuns.some(item => item.valid) ? 'is-valid' : 'is-invalid'}`}>
                  {activeRuns.some(item => item.valid) ? <Check size={13} /> : <AlertTriangle size={13} />}
                  {gridMode
                    ? `${activeRuns.some(item => item.valid) ? 'SOLVED' : 'FAILED'} ${activeRuns.filter(item => item.valid).length}/${activeRuns.length}`
                    : activeRuns[0].valid ? 'SOLVED' : 'FAILED'}
                  {!gridMode ? <small>settles t {activeRuns[0].settleT}</small> : null}
                </span>
              ) : null}
            </div>
            <div className="preview-shell">
              <MazePreview
                tiles={tiles} timestep={timestep} frame={frame}
                frameCount={timing.frames} fps={timing.fps} appearance={renderAppearance} text={text}
                exact={exactUrl} exactStatus={exactMode ? exactStatus : 'off'}
              />
            </div>
            <PlaybackBar
              playing={playing} frame={frame} frames={timing.frames} timestep={timestep} fps={timing.fps}
              loop={previewLoop} onPlaying={setPlaying} onFrame={setFrame} onLoop={setPreviewLoop}
            />
          </section>
          <TimelineEditor
            points={points} mapping={timing.mapping} mapper={mapper} schedule={schedule} change={change}
            frame={frame} frames={timing.frames} timestep={timestep} tiles={tiles}
            appearance={renderAppearance} selectedId={selectedPoint} onSelected={setSelectedPoint} onPoints={setPoints}
            onEditStart={beginEdit} onEditEnd={endEdit} onMapping={setMapping} onAdd={addPoint}
            onDelete={deletePoint} onReset={resetCurve} onFrame={setFrame}
          />
        </main>

        <Inspector
          tab={tab} timing={timing} appearance={appearance} text={text} exportConfig={exportConfig}
          hasRun={canExport} readyCount={readyCount} neededCount={neededCount}
          ffmpeg={health?.ffmpeg ?? false} exporting={exporting}
          exportResult={exportResult} history={exportHistory}
          onTab={setTab} onTiming={updateTiming}
          onAppearance={patch => {
            if (patch.layout) setLayout(patch.layout)
            else setAppearance(value => ({ ...value, ...patch }))
          }}
          onText={patch => setText(value => ({ ...value, ...patch }))} onExportConfig={patch => setExportConfig(value => ({ ...value, ...patch }))}
          onResetLook={() => setAppearance({ ...DEFAULT_APPEARANCE, layout: appearance.layout })} onResetText={() => setText({ ...DEFAULT_TEXT })}
          onExport={() => void createExport()} onDeleteExport={filename => void removeExport(filename)}
        />
      </div>

      <footer className="statusbar">
        <span><strong>t {timestep}</strong> / 999</span>
        <span>{gridMode ? <><strong>{filledSlots.length}</strong> / 9</> : <>Maze <strong>#{selected ? String(selected.index + 1).padStart(3, '0') : '—'}</strong></>}</span>
        <span>Seed <strong>{seed}</strong> · noise <strong>{diffusionSeed}</strong></span>
        <span>{activeRuns.length ? <><i className={`status-dot ${activeRuns.every(item => item.valid) ? 'is-valid' : 'is-invalid'}`} /> {gridMode ? `${readyCount}/${neededCount} ready` : (run?.cached ? 'Run cached' : `Ran in ${run?.elapsedSeconds}s`)}</> : 'No model run'}</span>
        <span className="statusbar__device">{health ? `${health.device.toUpperCase()} · ${health.ffmpeg ? 'video ready' : 'GIF only'}` : 'Connecting…'}</span>
        <span className="shortcuts">Space Play · ← → Step · K Keypoint · Del Remove</span>
      </footer>

      {error ? <div className="toast" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X size={15} /></button></div> : null}
      <button type="button" className="inspector-toggle" onClick={() => setInspectorOpen(value => !value)} title="Toggle inspector">{inspectorOpen ? '›' : '‹'}</button>
    </div>
  )
}

export default App
