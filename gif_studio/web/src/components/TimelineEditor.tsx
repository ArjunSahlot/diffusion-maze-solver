import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import Crosshair from 'lucide-react/dist/esm/icons/crosshair'
import Plus from 'lucide-react/dist/esm/icons/plus'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import WandSparkles from 'lucide-react/dist/esm/icons/wand-sparkles'
import { useMemo, useRef, useState } from 'react'
import type { AppearanceConfig, Easing, Keypoint, Mapping, PreviewTile } from '../types'
import { evaluateCurve, type Mapper } from '../lib/timeline'
import { Filmstrip } from './Filmstrip'
import { Tip } from './Controls'

const WIDTH = 900
const HEIGHT = 268
const LEFT = 54
const RIGHT = 18
const TOP = 20
const BOTTOM = 34
const PLOT_W = WIDTH - LEFT - RIGHT
const PLOT_H = HEIGHT - TOP - BOTTOM

const EASINGS: { value: Easing; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Cubic ease in' },
  { value: 'ease-out', label: 'Cubic ease out' },
  { value: 'ease-in-out', label: 'Cubic in/out' },
  { value: 'smoothstep', label: 'Smoothstep' },
  { value: 'hold', label: 'Hold, then jump' },
]

const px = (x: number) => LEFT + x * PLOT_W
const py = (y: number) => TOP + (1 - y) * PLOT_H

export function TimelineEditor({
  points, mapping, mapper, schedule, change, frame, frames, timestep, tiles, appearance,
  selectedId, onSelected, onPoints, onEditStart, onEditEnd, onMapping, onAdd, onDelete, onReset, onFrame,
}: {
  points: Keypoint[]
  mapping: Mapping
  mapper: Mapper
  schedule: number[]
  change: number[]
  frame: number
  frames: number
  timestep: number
  tiles: PreviewTile[]
  appearance: AppearanceConfig
  selectedId: string | null
  onSelected: (id: string | null) => void
  onPoints: (points: Keypoint[]) => void
  onEditStart: () => void
  onEditEnd: () => void
  onMapping: (mapping: Mapping) => void
  onAdd: () => void
  onDelete: () => void
  onReset: () => void
  onFrame: (frame: number) => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const playheadX = frame / Math.max(frames - 1, 1)
  const selected = points.find(point => point.id === selectedId) ?? null

  const curvePath = useMemo(() => (
    Array.from({ length: 181 }, (_, index) => {
      const x = index / 180
      return `${index ? 'L' : 'M'} ${px(x).toFixed(2)} ${py(evaluateCurve(points, x)).toFixed(2)}`
    }).join(' ')
  ), [points])

  const bars = useMemo(() => {
    const ceiling = Math.max(...change.slice(1), 0)
    if (!ceiling) return []
    return change.map((value, index) => ({
      x: index / Math.max(change.length - 1, 1),
      height: Math.min(1, value / ceiling),
    })).slice(1)
  }, [change])

  const evenness = useMemo(() => {
    const values = change.slice(1)
    if (values.length < 2) return null
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    if (!mean) return null
    const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
    return Math.max(0, 1 - spread / mean)
  }, [change])

  const eventPoint = (clientX: number, clientY: number) => {
    const rect = svg.current!.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * WIDTH
    const y = ((clientY - rect.top) / rect.height) * HEIGHT
    return {
      x: Math.max(0, Math.min(1, (x - LEFT) / PLOT_W)),
      y: Math.max(0, Math.min(1, 1 - (y - TOP) / PLOT_H)),
    }
  }

  const handleMove = (clientX: number, clientY: number) => {
    if (!dragging) return
    const index = points.findIndex(point => point.id === dragging)
    if (index < 0) return
    const next = points.map(point => ({ ...point }))
    const value = eventPoint(clientX, clientY)
    const previous = next[index - 1]
    const following = next[index + 1]
    next[index].x = index === 0 || index === next.length - 1
      ? next[index].x
      : Math.max(previous.x + 0.002, Math.min(following.x - 0.002, value.x))
    // Monotonic: playback never walks backwards through the denoising run.
    next[index].y = Math.max(previous?.y ?? 0, Math.min(following?.y ?? 1, value.y))
    onPoints(next)
  }

  return (
    <section className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="timeline-title">
          Mapping
          <Tip>Up is progress through the denoising run, across is position in the animation. The curve only ever moves forward.</Tip>
        </div>
        <div className="preset-group">
          <button type="button" className={mapping === 'timestep' ? 'is-active' : ''} onClick={() => onMapping('timestep')} title="Measure progress in raw timesteps: a straight line walks t evenly from 999 to 0.">
            Equal timesteps
          </button>
          <button type="button" className={mapping === 'change' ? 'is-active' : ''} onClick={() => onMapping('change')} title="Measure progress in accumulated visual change: a straight line gives frames that each move the picture by the same amount.">
            <WandSparkles size={13} /> Equal change
          </button>
        </div>
        {evenness !== null ? (
          <span className="evenness" title="How evenly change is spread across the animation. 100% means every frame moves the picture by the same amount.">
            Evenness <strong>{Math.round(evenness * 100)}%</strong>
          </span>
        ) : null}
        <div className="timeline-tools">
          <button type="button" onClick={onAdd} title="Add a keypoint at the playhead (K)"><Plus size={14} /> Keypoint</button>
          <button type="button" onClick={onReset} disabled={points.length === 2 && points[0].easing === 'linear'} title="Back to a straight two-point curve"><RotateCcw size={14} /> Reset</button>
        </div>
      </div>
      <div className="graph-wrap">
        <svg
          ref={svg}
          className="timeline-graph"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Editable monotonic mapping from playback position to denoising progress"
          onPointerMove={event => handleMove(event.clientX, event.clientY)}
          onPointerUp={event => {
            if (!dragging) return
            event.currentTarget.releasePointerCapture(event.pointerId)
            setDragging(null)
            onEditEnd()
          }}
          onPointerCancel={() => { setDragging(null); onEditEnd() }}
          onDoubleClick={event => {
            const value = eventPoint(event.clientX, event.clientY)
            onEditStart()
            const point: Keypoint = { id: Math.random().toString(36).slice(2, 9), x: value.x, y: evaluateCurve(points, value.x), easing: 'smoothstep' }
            onPoints([...points, point].sort((a, b) => a.x - b.x))
            onSelected(point.id)
            onEditEnd()
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map(value => (
            <g key={`grid-${value}`}>
              <line x1={LEFT} y1={TOP + value * PLOT_H} x2={WIDTH - RIGHT} y2={TOP + value * PLOT_H} className="graph-grid" />
              <text x={LEFT - 10} y={TOP + value * PLOT_H + 4} textAnchor="end" className="graph-label">t {mapper(1 - value)}</text>
              <line x1={LEFT + value * PLOT_W} y1={TOP} x2={LEFT + value * PLOT_W} y2={HEIGHT - BOTTOM} className="graph-grid graph-grid--vertical" />
              <text x={LEFT + value * PLOT_W} y={HEIGHT - 12} textAnchor="middle" className="graph-label">{Math.round(value * 100)}%</text>
            </g>
          ))}
          {bars.map((bar, index) => (
            <rect
              key={index}
              x={px(bar.x) - PLOT_W / bars.length / 2}
              y={TOP + PLOT_H * (1 - bar.height * 0.7)}
              width={Math.max(1.5, PLOT_W / bars.length - 0.5)}
              height={PLOT_H * bar.height * 0.7}
              className="change-bar"
            />
          ))}
          <path d={`${curvePath} L ${WIDTH - RIGHT} ${HEIGHT - BOTTOM} L ${LEFT} ${HEIGHT - BOTTOM} Z`} fill="#4f8ff7" fillOpacity=".055" />
          <path d={curvePath} className="curve-line" />
          {points.map(point => (
            <g key={point.id}>
              <circle cx={px(point.x)} cy={py(point.y)} r={point.id === selectedId ? 6 : 4} className={`curve-point ${point.id === selectedId ? 'is-selected' : ''}`} />
              <circle
                cx={px(point.x)} cy={py(point.y)} r={10} fill="transparent" className="point-hit"
                onPointerDown={event => {
                  event.preventDefault()
                  event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
                  setDragging(point.id)
                  onSelected(point.id)
                  onEditStart()
                }}
              />
            </g>
          ))}
          <line x1={px(playheadX)} y1={TOP - 6} x2={px(playheadX)} y2={HEIGHT - BOTTOM + 6} className="playhead" />
          <path d={`M ${px(playheadX) - 5} ${TOP - 7} h 10 l -5 6 z`} className="playhead-cap" />
          <g transform={`translate(${Math.max(LEFT + 48, Math.min(WIDTH - RIGHT - 48, px(playheadX)))}, 8)`}>
            <rect x="-44" y="-8" width="88" height="19" rx="4" className="playhead-label-bg" />
            <text y="5" textAnchor="middle" className="playhead-label">F{frame + 1} · t {timestep}</text>
          </g>
        </svg>
        <span className="axis-title axis-title--y">Denoising progress</span>
        <span className="axis-title axis-title--x">Playback position</span>
      </div>
      <Filmstrip tiles={tiles} schedule={schedule} appearance={appearance} frame={frame} onScrub={onFrame} />
      <div className="segment-editor">
        <div className="segment-editor__identity">
          <Crosshair size={14} />
          <span>{selected ? `${Math.round(selected.x * 100)}% → t ${mapper(selected.y)}` : 'Double-click the graph to add a point'}</span>
          <span className="subtle">{points.length} keypoint{points.length === 1 ? '' : 's'}</span>
        </div>
        <label>
          <span>Easing</span>
          <div className="select-with-icon">
            <select
              value={selected?.easing ?? 'linear'}
              disabled={!selected || selected === points.at(-1)}
              onChange={event => {
                if (!selected) return
                onEditStart()
                onPoints(points.map(point => point.id === selected.id ? { ...point, easing: event.target.value as Easing } : point))
                onEditEnd()
              }}
            >
              {EASINGS.map(easing => <option key={easing.value} value={easing.value}>{easing.label}</option>)}
            </select>
            <ChevronDown size={13} />
          </div>
        </label>
        <button type="button" className="danger-quiet" onClick={onDelete} disabled={!selected || selected === points[0] || selected === points.at(-1)} title="Delete the selected keypoint (Del)"><Trash2 size={14} /> Delete</button>
      </div>
    </section>
  )
}
