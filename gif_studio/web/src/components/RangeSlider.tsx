import { useCallback, useRef, useState } from 'react'

export type Range = [number, number]

/** Two-handle range with the current span shown inline, so filters need no separate labels. */
export function RangeSlider({ label, min, max, step = 1, value, onChange, suffix = '', title }: {
  label: string
  min: number
  max: number
  step?: number
  value: Range
  onChange: (value: Range) => void
  suffix?: string
  title?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const dragging = useRef<0 | 1 | null>(null)
  const [, setDragTick] = useState(0)
  const [low, high] = value
  const wide = low <= min && high >= max
  const percent = (input: number) => ((input - min) / (max - min)) * 100

  const valueAt = useCallback((clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    const raw = min + ((clientX - rect.left) / rect.width) * (max - min)
    return Math.min(max, Math.max(min, Math.round(raw / step) * step))
  }, [max, min, step])

  const move = (handle: 0 | 1, next: number) => {
    const [currentLow, currentHigh] = valueRef.current
    onChange(handle === 0 ? [Math.min(next, currentHigh), currentHigh] : [currentLow, Math.max(next, currentLow)])
  }

  const nudge = (handle: 0 | 1) => (event: React.KeyboardEvent) => {
    const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    move(handle, value[handle] + delta)
  }

  return (
    <div className="range-filter" title={title}>
      <div className="range-filter__head">
        <span>{label}</span>
        <output className={wide ? 'is-any' : ''}>
          {wide ? 'any' : `${low}${suffix} – ${high}${suffix}`}
        </output>
      </div>
      <div
        className="range-track"
        ref={track}
        onPointerDown={event => {
          const next = valueAt(event.clientX)
          const handle: 0 | 1 = Math.abs(next - low) <= Math.abs(next - high) ? 0 : 1
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = handle
          setDragTick(tick => tick + 1)
          move(handle, next)
        }}
        onPointerMove={event => { if (dragging.current !== null) move(dragging.current, valueAt(event.clientX)) }}
        onPointerUp={() => { dragging.current = null; setDragTick(tick => tick + 1) }}
        onPointerCancel={() => { dragging.current = null; setDragTick(tick => tick + 1) }}
      >
        <span className="range-track__fill" style={{ left: `${percent(low)}%`, right: `${100 - percent(high)}%` }} />
        {([0, 1] as const).map(handle => (
          <span
            key={handle}
            role="slider"
            tabIndex={0}
            aria-label={`${label} ${handle ? 'maximum' : 'minimum'}`}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value[handle]}
            className={`range-track__thumb ${dragging.current === handle ? 'is-dragging' : ''}`}
            style={{ left: `${percent(value[handle])}%` }}
            onKeyDown={nudge(handle)}
          />
        ))}
      </div>
    </div>
  )
}
