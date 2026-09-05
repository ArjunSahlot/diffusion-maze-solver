import { useEffect, useRef } from 'react'
import type { AppearanceConfig, PreviewTile, TextConfig } from '../types'
import { FONT_FAMILY, blitFrame, counterFill, counterText, meanClarity, paintFrame, rgb, textAlpha, tileBoxes, tileScore } from '../lib/draw'

export type ExactStatus = 'off' | 'loading' | 'ready' | 'error'

export function MazePreview({ tiles, timestep, frame, frameCount, fps, appearance, text, exact, exactStatus }: {
  tiles: PreviewTile[]
  timestep: number
  frame: number
  frameCount: number
  fps: number
  appearance: AppearanceConfig
  text: TextConfig
  exact: string | null
  exactStatus: ExactStatus
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const filled = tiles.filter(tile => tile.maze)
  const hasFrames = tiles.some(tile => tile.frames)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    // Draw at the real export resolution and let CSS scale it down, so the preview
    // and the exported file agree pixel for pixel.
    const size = appearance.resolution
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size
      canvas.height = size
    }
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = appearance.background
    ctx.fillRect(0, 0, size, size)

    const boxes = tileBoxes(appearance, tiles.length)
    boxes.forEach((box, index) => {
      const tile = tiles[index]
      if (tile?.maze) {
        blitFrame(ctx, paintFrame(tile.maze, appearance, tile.frames, timestep), box.x, box.y, box.size)
        return
      }
      if (tiles.length <= 1) return
      ctx.fillStyle = 'rgba(255,255,255,0.035)'
      ctx.fillRect(box.x, box.y, box.size, box.size)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.size - 1, box.size - 1)
      ctx.fillStyle = 'rgba(255,255,255,0.22)'
      ctx.font = `${Math.max(10, Math.floor(box.size * 0.18))}px ui-sans-serif, system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(index + 1), box.x + box.size / 2, box.y + box.size / 2)
    })
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'

    const alpha = textAlpha(text, frame, frameCount)
    const value = counterText(
      text, timestep, frame, frameCount, fps,
      meanClarity(tiles, timestep, appearance.gamma),
      tileScore(tiles),
    )
    if (!text.enabled || alpha <= 0 || !value) return
    ctx.font = `${text.weight === 'bold' ? 700 : 400} ${text.size}px ${FONT_FAMILY[text.family]}`
    ctx.textBaseline = 'alphabetic'
    ctx.globalAlpha = alpha
    const measured = ctx.measureText(value)
    const ascent = measured.actualBoundingBoxAscent || text.size * 0.8
    const descent = measured.actualBoundingBoxDescent || text.size * 0.2
    const boxWidth = measured.width + text.outline * 2 + text.padding * 2
    const boxHeight = ascent + descent + text.outline * 2 + text.padding * 2
    const [row, column] = text.position.split('-')
    const spanX = size - boxWidth
    const spanY = size - boxHeight
    const x = (column === 'left' ? text.margin : column === 'right' ? spanX - text.margin : spanX / 2) + text.offsetX
    const y = (row === 'top' ? text.margin : row === 'bottom' ? spanY - text.margin : spanY / 2) + text.offsetY
    if (text.backgroundOpacity > 0) {
      const [r, g, b] = rgb(text.background)
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${text.backgroundOpacity})`
      ctx.beginPath()
      ctx.roundRect(x, y, boxWidth, boxHeight, text.radius)
      ctx.fill()
    }
    const textX = x + text.padding + text.outline
    const textY = y + text.padding + text.outline + ascent
    if (text.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,.6)'
      ctx.shadowBlur = 3
      ctx.shadowOffsetX = 2
      ctx.shadowOffsetY = 2
    }
    if (text.outline) {
      ctx.lineWidth = text.outline * 2
      ctx.strokeStyle = '#000000'
      ctx.lineJoin = 'round'
      ctx.strokeText(value, textX, textY)
    }
    ctx.fillStyle = counterFill(text, value)
    ctx.fillText(value, textX, textY)
    ctx.shadowColor = 'transparent'
    ctx.globalAlpha = 1
  }, [appearance, fps, frame, frameCount, text, tiles, timestep])

  const note = exactStatus === 'loading'
    ? 'Rendering export frame…'
    : exactStatus === 'ready'
      ? 'Export pipeline'
      : exactStatus === 'error'
        ? 'Export preview failed'
        : !hasFrames && filled.length
          ? 'Geometry preview · run the model for its output'
          : null

  return (
    <div className={`preview-stage ${exactStatus === 'ready' ? 'is-exact' : ''} ${exactStatus === 'loading' ? 'is-exact-loading' : ''}`}>
      <canvas ref={canvasRef} aria-label={`Maze preview at timestep ${timestep}`} />
      {exact ? <img className="preview-exact" src={exact} alt={`Export render at timestep ${timestep}`} /> : null}
      {note ? (
        <span className={`preview-note ${exactStatus === 'off' ? '' : 'preview-note--exact'} ${exactStatus === 'error' ? 'preview-note--error' : ''}`}>
          {note}
        </span>
      ) : null}
      {!filled.length ? <div className="preview-empty">{tiles.length > 1 ? 'Click mazes to fill the 3×3' : 'Choose a maze to begin'}</div> : null}
    </div>
  )
}
