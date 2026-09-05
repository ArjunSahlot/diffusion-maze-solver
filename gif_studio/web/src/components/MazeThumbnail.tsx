import { memo, useEffect, useRef } from 'react'
import type { MazeRecord } from '../types'
import { type MazeStats, describe } from '../lib/mazeStats'

function MazeThumbnailComponent({ maze, stats, selected, slot, onSelect }: {
  maze: MazeRecord
  stats: MazeStats
  selected: boolean
  slot?: number
  onSelect: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const size = maze.grid.length
    context.imageSmoothingEnabled = false
    context.fillStyle = '#090a0c'
    context.fillRect(0, 0, size, size)
    context.fillStyle = '#272b30'
    maze.grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === '0') context.fillRect(x, y, 1, 1)
      }
    })
    context.fillStyle = '#4f8ff7'
    maze.path.forEach(([y, x]) => context.fillRect(x, y, 1, 1))
    context.fillStyle = '#2ecc70'
    context.fillRect(maze.start[1], maze.start[0], 1, 1)
    context.fillStyle = '#e84d3d'
    context.fillRect(maze.stop[1], maze.stop[0], 1, 1)
  }, [maze])

  return (
    <button
      type="button"
      className={`maze-thumb ${selected ? 'is-selected' : ''} ${slot ? 'is-picked' : ''}`}
      onClick={onSelect}
      title={describe(maze, stats)}
    >
      <canvas ref={canvas} width={maze.grid.length} height={maze.grid.length} />
      {slot ? <span className="maze-thumb__slot">{slot}</span> : null}
      <span className={`maze-thumb__status ${maze.valid === true ? 'is-valid' : maze.valid === false ? 'is-invalid' : ''}`} />
    </button>
  )
}

export const MazeThumbnail = memo(MazeThumbnailComponent)
