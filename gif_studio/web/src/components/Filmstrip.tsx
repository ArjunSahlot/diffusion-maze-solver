import { memo, useEffect, useRef, type MouseEvent } from 'react'
import type { AppearanceConfig, PreviewTile } from '../types'
import { blitFrame, paintFrame } from '../lib/draw'

const CELL = 46
const GAP = 3

function drawThumb(
  ctx: CanvasRenderingContext2D,
  tiles: PreviewTile[],
  appearance: AppearanceConfig,
  timestep: number,
  x: number,
  y: number,
  cell: number,
) {
  if (tiles.length <= 1) {
    const tile = tiles[0]
    if (tile?.maze) blitFrame(ctx, paintFrame(tile.maze, appearance, tile.frames, timestep), x, y, cell)
    return
  }
  const gap = 1
  const inner = Math.floor((cell - gap * 2) / 3)
  for (let index = 0; index < 9; index += 1) {
    const tile = tiles[index]
    if (!tile?.maze) continue
    const row = Math.floor(index / 3)
    const column = index % 3
    blitFrame(
      ctx,
      paintFrame(tile.maze, appearance, tile.frames, timestep),
      x + column * (inner + gap),
      y + row * (inner + gap),
      inner,
    )
  }
}

/** A strip of the frames the current schedule actually samples, aligned to the graph's x axis. */
function FilmstripComponent({ tiles, schedule, appearance, frame, onScrub }: {
  tiles: PreviewTile[]
  schedule: number[]
  appearance: AppearanceConfig
  frame: number
  onScrub: (frame: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !wrap || !ctx) return
    const width = Math.max(240, Math.floor(wrap.clientWidth))
    const slots = Math.max(2, Math.min(schedule.length, Math.floor((width + GAP) / (CELL + GAP))))
    canvas.width = width
    canvas.height = CELL + 16
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!tiles.some(tile => tile.maze)) return
    const step = (width - CELL) / Math.max(slots - 1, 1)
    for (let slot = 0; slot < slots; slot += 1) {
      const index = Math.round((slot / Math.max(slots - 1, 1)) * (schedule.length - 1))
      const timestep = schedule[index] ?? 0
      drawThumb(ctx, tiles, appearance, timestep, slot * step, 0, CELL)
      ctx.fillStyle = Math.abs(index - frame) <= schedule.length / (slots * 2) ? '#7fb2ff' : '#5a6270'
      ctx.font = '10px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(`t${timestep}`, slot * step + CELL / 2, CELL + 12)
    }
  }, [appearance, frame, schedule, tiles])

  const scrub = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    onScrub(Math.round(ratio * (schedule.length - 1)))
  }

  return (
    <div className="filmstrip" ref={wrapRef}>
      <canvas ref={canvasRef} onClick={scrub} title="Frames sampled by the current curve. Click to jump." />
    </div>
  )
}

export const Filmstrip = memo(FilmstripComponent)
