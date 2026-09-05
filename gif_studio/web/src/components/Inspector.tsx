import Check from 'lucide-react/dist/esm/icons/check'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import Download from 'lucide-react/dist/esm/icons/download'
import FileArchive from 'lucide-react/dist/esm/icons/file-archive'
import FileImage from 'lucide-react/dist/esm/icons/file-image'
import Film from 'lucide-react/dist/esm/icons/film'
import ImageIcon from 'lucide-react/dist/esm/icons/image'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2'
import type { AppearanceConfig, ExportConfig, ExportEntry, InspectorTab, MetricKey, TextConfig, TimingConfig } from '../types'
import { ColorInput, Field, Tip, Toggle } from './Controls'
import { PaddingInput } from './PaddingInput'

const tabs: { key: InspectorTab; label: string }[] = [
  { key: 'timing', label: 'Timing' },
  { key: 'appearance', label: 'Look' },
  { key: 'text', label: 'Text' },
  { key: 'export', label: 'Export' },
]

const positions = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

const FORMATS = [
  ['gif', 'GIF', ImageIcon], ['mp4', 'MP4', Film], ['webm', 'WebM', Film],
  ['apng', 'APNG', FileImage], ['png-zip', 'PNG frames', FileArchive],
] as const

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

/** GIF delays are 10ms ticks. Browsers treat 0–10ms as 100ms, so 60fps GIFs play at 10fps. */
function frameDelayMs(fps: number, format: ExportConfig['format']): number {
  const raw = 1000 / Math.max(fps, 0.001)
  if (format !== 'gif') return raw
  return Math.max(20, Math.round(raw / 10) * 10)
}

export function Inspector({
  tab, timing, appearance, text, exportConfig, hasRun, readyCount, neededCount, ffmpeg, exporting, exportResult, history,
  onTab, onTiming, onAppearance, onText, onExportConfig, onResetLook, onResetText, onExport, onDeleteExport,
}: {
  tab: InspectorTab
  timing: TimingConfig
  appearance: AppearanceConfig
  text: TextConfig
  exportConfig: ExportConfig
  hasRun: boolean
  readyCount: number
  neededCount: number
  ffmpeg: boolean
  exporting: boolean
  exportResult: ExportEntry | null
  history: ExportEntry[]
  onTab: (tab: InspectorTab) => void
  onTiming: (patch: Partial<TimingConfig>) => void
  onAppearance: (patch: Partial<AppearanceConfig>) => void
  onText: (patch: Partial<TextConfig>) => void
  onExportConfig: (patch: Partial<ExportConfig>) => void
  onResetLook: () => void
  onResetText: () => void
  onExport: () => void
  onDeleteExport: (filename: string) => void
}) {
  const frameMs = frameDelayMs(timing.fps, exportConfig.format)
  const motion = timing.frames * frameMs / 1000
  const duration = motion + (timing.startHold + timing.endHold) / 1000
  const gifCapped = exportConfig.format === 'gif' && frameMs > 1000 / timing.fps + 0.5
  const previewable = exportResult && /\.(gif|png)$/.test(exportResult.filename)
  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="tablist">
        {tabs.map(item => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'is-active' : ''} onClick={() => onTab(item.key)}>{item.label}</button>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'timing' ? (
          <div className="inspector-section">
            <div className="section-title">Playback</div>
            <Field label="Frames" tip="How many unique frames the animation samples from the 1,000-step run.">
              <input type="number" min={2} max={600} value={timing.frames} onChange={event => onTiming({ frames: Math.max(2, Math.min(600, Number(event.target.value))) })} />
            </Field>
            <Field label="FPS" tip="Playback rate. GIF files cannot go faster than 50 fps: shorter delays are stored as 10ms and most players treat that as 100ms, so a 60 fps GIF plays at 10 fps. Use MP4 or WebM for a true 60 fps. Opening and solved holds are added on top.">
              <input type="number" min={1} max={60} step={1} value={timing.fps} onChange={event => onTiming({ fps: Number(event.target.value) })} />
            </Field>
            <Field label="Opening hold" tip="Extra time on the first frame.">
              <div className="input-suffix"><input type="number" min={0} max={60000} step={50} value={timing.startHold} onChange={event => onTiming({ startHold: Number(event.target.value) })} /><span>ms</span></div>
            </Field>
            <Field label="Solved hold" tip="Extra time on the final solved frame.">
              <div className="input-suffix"><input type="number" min={0} max={60000} step={50} value={timing.endHold} onChange={event => onTiming({ endHold: Number(event.target.value) })} /><span>ms</span></div>
            </Field>
            <div className="timing-facts">
              <span>Frames alone</span><code>{motion.toFixed(2)}s</code>
              <span>With holds</span><code>{duration.toFixed(2)}s</code>
            </div>
            {gifCapped ? (
              <p className="inline-warning">GIF will play at {Math.round(1000 / frameMs)} fps ({motion.toFixed(2)}s), not {timing.fps}. Export MP4 or WebM for {timing.fps} fps.</p>
            ) : null}
            <div className="divider" />
            <div className="section-title">Equal change</div>
            <Field label="Change metric" tip="What counts as change. Pixel difference is the average per-pixel move; threshold flips only counts cells crossing between path and no-path.">
              <select value={timing.metric} onChange={event => onTiming({ metric: event.target.value as MetricKey })}>
                <option value="pixel">Pixel difference</option>
                <option value="rms">RMS pixel difference</option>
                <option value="path">Path growth only</option>
                <option value="flips">Threshold flips</option>
              </select>
            </Field>
            <Field label="Sensitivity" tip="Above 1 gives busy moments even more frames; below 1 flattens the effect back towards equal timesteps.">
              <div className="range-with-value"><input type="range" min={0.25} max={3} step={0.05} value={timing.sensitivity} onChange={event => onTiming({ sensitivity: Number(event.target.value) })} /><code>{timing.sensitivity.toFixed(2)}</code></div>
            </Field>
          </div>
        ) : null}

        {tab === 'appearance' ? (
          <div className="inspector-section">
            <div className="section-title">Layout</div>
            <Field label="Frame" tip="Single maze, or nine mazes denoising on the same timeline. Click mazes in the gallery to fill slots; Fill 3×3 uses the current sort.">
              <div className="layout-picks">
                <button type="button" className={appearance.layout !== 'grid3' ? 'is-on' : ''} onClick={() => onAppearance({ layout: 'single' })}>Single</button>
                <button type="button" className={appearance.layout === 'grid3' ? 'is-on' : ''} onClick={() => onAppearance({ layout: 'grid3' })}>3×3</button>
              </div>
            </Field>
            {appearance.layout === 'grid3' ? (
              <Field label="Tile gap" tip="Empty pixels between the nine mazes. 768 or 1024 looks better than 512 for a 3×3.">
                <div className="range-with-value"><input type="range" min={0} max={24} step={1} value={appearance.gridGap ?? 6} onChange={event => onAppearance({ gridGap: Number(event.target.value) })} /><code>{appearance.gridGap ?? 6}</code></div>
              </Field>
            ) : null}
            <div className="divider" />
            <div className="section-title section-title--action">Maze palette <button type="button" onClick={onResetLook} title="Restore the colours the project ships with"><RotateCcw size={13} /> Reset</button></div>
            <Field label="Open cells"><ColorInput value={appearance.openColor} onChange={value => onAppearance({ openColor: value })} /></Field>
            <Field label="Walls"><ColorInput value={appearance.wallColor} onChange={value => onAppearance({ wallColor: value })} /></Field>
            <Field label="Prediction"><ColorInput value={appearance.pathColor} onChange={value => onAppearance({ pathColor: value })} /></Field>
            <Field label="Start"><ColorInput value={appearance.startColor} onChange={value => onAppearance({ startColor: value })} /></Field>
            <Field label="Goal"><ColorInput value={appearance.goalColor} onChange={value => onAppearance({ goalColor: value })} /></Field>
            <Field label="Canvas" tip="Fills the frame around the maze."><ColorInput value={appearance.background} onChange={value => onAppearance({ background: value })} /></Field>
            <div className="divider" />
            <Field label="Canvas size" tip="Export resolution. The maze fills the padded area (nearest-neighbour), so 0 px frame padding means edge to edge.">
              <select value={appearance.resolution} onChange={event => onAppearance({ resolution: Number(event.target.value) })}>
                {[256, 400, 512, 640, 768, 1024].map(size => <option key={size} value={size}>{size} × {size}</option>)}
              </select>
            </Field>
            <Field label="Maze border" tip="Wall-coloured border, measured in maze cells.">
              <select value={appearance.borderCells} onChange={event => onAppearance({ borderCells: Number(event.target.value) })}>
                <option value={0}>None</option><option value={1}>1 cell</option><option value={2}>2 cells</option><option value={3}>3 cells</option>
              </select>
            </Field>
            <PaddingInput appearance={appearance} text={text} onChange={onAppearance} />
            <Field label="Noise on walls" tip="The model predicts every cell, walls included — on by default, matching the live demo. Off keeps the early noise inside the corridors.">
              <Toggle checked={!appearance.maskPrediction} onChange={value => onAppearance({ maskPrediction: !value })} label="Show prediction over walls" />
            </Field>
            <Field label="Path contrast" tip="Gamma on the prediction strength. Above 1 hides faint guesses and makes the path pop late; below 1 brings the early noise forward.">
              <div className="range-with-value"><input type="range" min={0.3} max={3} step={0.05} value={appearance.gamma} onChange={event => onAppearance({ gamma: Number(event.target.value) })} /><code>{appearance.gamma.toFixed(2)}</code></div>
            </Field>
          </div>
        ) : null}

        {tab === 'text' ? (
          <div className="inspector-section">
            <div className="section-title section-title--action">Counter <Toggle checked={text.enabled} onChange={enabled => onText({ enabled })} label="Show counter text" /></div>
            <Field label="Template" tip="{denoised} is how close the open cells are to the finished path, from the pixels — not t. {status} is SOLVED or FAILED. On a 3×3, {solved}/{total} is the score (SOLVED 8/9). Other tokens: {t}, {frame}, {frames}, {progress}, {seconds}, {failed}." vertical>
              <input value={text.template} onChange={event => onText({ template: event.target.value })} disabled={!text.enabled} />
            </Field>
            <div className="token-row">
              {['{t}', '{frame}', '{progress}', '{denoised}', '{seconds}', '{status}', '{solved}', '{total}'].map(token => (
                <button key={token} type="button" disabled={!text.enabled} onClick={() => onText({ template: `${text.template} ${token}`.trim() })}>{token}</button>
              ))}
            </div>
            <Field label="Solved text" tip="Final t = 0 frame when at least one maze is valid. A 3×3 appends the score, so SOLVED becomes SOLVED 8/9. Drawn in green, all caps. Leave empty to keep counting." vertical>
              <input value={text.solvedTemplate} placeholder="SOLVED" onChange={event => onText({ solvedTemplate: event.target.value })} disabled={!text.enabled} />
            </Field>
            <Field label="Failed text" tip="Final t = 0 frame when none of the mazes are valid. A 3×3 appends the score (FAILED 0/9). Drawn in red, all caps." vertical>
              <input value={text.failedTemplate} placeholder="FAILED" onChange={event => onText({ failedTemplate: event.target.value })} disabled={!text.enabled} />
            </Field>
            <Field label="Keep off maze" tip="Insets the maze so the counter sits in an empty band. Fine-tune the band under Look → Frame padding.">
              <Toggle checked={appearance.autoPad} onChange={autoPad => onAppearance({ autoPad })} label="Keep counter off the maze" />
            </Field>
            <Field label="Typeface" tip="These are the exact fonts the exporter draws with, so the preview matches the file.">
              <select value={text.family} onChange={event => onText({ family: event.target.value as TextConfig['family'] })} disabled={!text.enabled}>
                <option value="mono">Mono</option><option value="sans">Sans</option><option value="serif">Serif</option>
              </select>
            </Field>
            <Field label="Weight"><select value={text.weight} onChange={event => onText({ weight: event.target.value as TextConfig['weight'] })} disabled={!text.enabled}><option value="regular">Regular</option><option value="bold">Bold</option></select></Field>
            <Field label="Size"><div className="input-suffix"><input type="number" min={8} max={180} value={text.size} onChange={event => onText({ size: Number(event.target.value) })} disabled={!text.enabled} /><span>px</span></div></Field>
            <Field label="Text colour"><ColorInput value={text.color} onChange={color => onText({ color })} /></Field>
            <div className="field field--vertical position-field">
              <span className="field__label">Position <Tip>Pick an anchor, then nudge with the offsets below.</Tip></span>
              <div className="position-grid">
                {positions.map(position => <button key={position} type="button" className={text.position === position ? 'is-active' : ''} onClick={() => onText({ position })} title={position.replace('-', ' ')}><span /></button>)}
              </div>
            </div>
            <div className="offset-row">
              <Field label="X offset"><input type="number" value={text.offsetX} onChange={event => onText({ offsetX: Number(event.target.value) })} /></Field>
              <Field label="Y offset"><input type="number" value={text.offsetY} onChange={event => onText({ offsetY: Number(event.target.value) })} /></Field>
            </div>
            <details className="advanced">
              <summary><ChevronRight size={14} /> Backdrop, fades & effects</summary>
              <Field label="Backdrop"><ColorInput value={text.background} onChange={background => onText({ background })} /></Field>
              <Field label="Backdrop opacity"><div className="range-with-value"><input type="range" min={0} max={1} step={0.05} value={text.backgroundOpacity} onChange={event => onText({ backgroundOpacity: Number(event.target.value) })} /><code>{Math.round(text.backgroundOpacity * 100)}%</code></div></Field>
              <Field label="Pill padding" tip="Space between the text and the edge of its backdrop."><input type="number" min={0} max={80} value={text.padding} onChange={event => onText({ padding: Number(event.target.value) })} /></Field>
              <Field label="Edge margin" tip="Gap between the counter and the edge of the canvas."><div className="input-suffix"><input type="number" min={0} max={400} value={text.margin} onChange={event => onText({ margin: Number(event.target.value) })} /><span>px</span></div></Field>
              <Field label="Corner radius"><input type="number" min={0} max={50} value={text.radius} onChange={event => onText({ radius: Number(event.target.value) })} /></Field>
              <Field label="Outline"><input type="number" min={0} max={12} value={text.outline} onChange={event => onText({ outline: Number(event.target.value) })} /></Field>
              <Field label="Shadow"><Toggle checked={text.shadow} onChange={shadow => onText({ shadow })} label="Counter shadow" /></Field>
              <Field label="Opacity"><div className="range-with-value"><input type="range" min={0} max={1} step={0.05} value={text.opacity} onChange={event => onText({ opacity: Number(event.target.value) })} /><code>{Math.round(text.opacity * 100)}%</code></div></Field>
              <Field label="Fade in" tip="Frames spent fading the counter in at the start."><div className="input-suffix"><input type="number" min={0} max={240} value={text.fadeInFrames} onChange={event => onText({ fadeInFrames: Number(event.target.value) })} /><span>fr</span></div></Field>
              <Field label="Fade out" tip="Frames spent fading the counter out before the end."><div className="input-suffix"><input type="number" min={0} max={240} value={text.fadeOutFrames} onChange={event => onText({ fadeOutFrames: Number(event.target.value) })} /><span>fr</span></div></Field>
              <button type="button" className="reset-inline" onClick={onResetText}><RotateCcw size={13} /> Reset counter</button>
            </details>
          </div>
        ) : null}

        {tab === 'export' ? (
          <div className="inspector-section export-section">
            <div className="section-title">Create export</div>
            <div className="format-grid">
              {FORMATS.map(([value, label, Icon]) => (
                <button
                  key={value} type="button"
                  className={exportConfig.format === value ? 'is-active' : ''}
                  disabled={(value === 'mp4' || value === 'webm') && !ffmpeg}
                  title={(value === 'mp4' || value === 'webm') && !ffmpeg ? 'ffmpeg is not installed on this machine' : undefined}
                  onClick={() => onExportConfig({ format: value })}
                >
                  <Icon size={16} /><span>{label}</span>{exportConfig.format === value ? <Check size={12} /> : null}
                </button>
              ))}
            </div>
            {exportConfig.format === 'gif' ? (
              <>
                <Field label="Colours" tip="GIF palette size. Fewer colours means a smaller file; the flat maze palette usually looks perfect well below 256. The eye preview uses this palette on the current frame.">
                  <div className="range-with-value"><input type="range" min={16} max={256} step={8} value={exportConfig.colors} onChange={event => onExportConfig({ colors: Number(event.target.value) })} /><code>{exportConfig.colors}</code></div>
                </Field>
                <Field label="Dither" tip="Scatters quantisation error. Helps gradients, but adds noise to flat colour and inflates the file. Visible in the eye preview."><Toggle checked={exportConfig.dither} onChange={dither => onExportConfig({ dither })} label="Dither GIF" /></Field>
              </>
            ) : null}
            {exportConfig.format === 'mp4' || exportConfig.format === 'webm' ? (
              <Field label="Quality" tip="Video bitrate quality. Higher keeps the hard pixel edges sharper.">
                <div className="range-with-value"><input type="range" min={20} max={100} value={exportConfig.quality} onChange={event => onExportConfig({ quality: Number(event.target.value) })} /><code>{exportConfig.quality}</code></div>
              </Field>
            ) : null}
            <Field label="Loop"><Toggle checked={exportConfig.loop} onChange={loop => onExportConfig({ loop })} label="Loop animation" /></Field>
            <div className="export-summary">
              <div><span>Output</span><strong>{appearance.resolution} × {appearance.resolution}</strong></div>
              <div><span>Frames</span><strong>{timing.frames}</strong></div>
              <div><span>Duration</span><strong>{duration.toFixed(2)}s</strong></div>
              <div><span>Source</span><strong>{appearance.layout === 'grid3' ? `3×3 · ${readyCount}/${neededCount}` : hasRun ? 'Real run' : 'Not analyzed'}</strong></div>
            </div>
            <button type="button" className="export-button" disabled={!hasRun || exporting} onClick={onExport}>
              <Download size={16} />{exporting ? 'Rendering…' : `Export ${exportConfig.format.toUpperCase()}`}
            </button>
            {!hasRun ? (
              <p className="inline-warning">
                {appearance.layout === 'grid3'
                  ? neededCount
                    ? `Analyze the remaining ${neededCount - readyCount} maze${neededCount - readyCount === 1 ? '' : 's'} first.`
                    : 'Fill at least one 3×3 slot, then analyze.'
                  : 'Run this maze through the model first.'}
              </p>
            ) : null}
            {previewable ? (
              <div className="export-preview">
                <img src={exportResult.url} alt="Latest export" />
                <span>Your file, playing</span>
              </div>
            ) : null}
            {history.length ? (
              <>
                <div className="section-title">Recent files</div>
                <ul className="export-history">
                  {history.map(entry => (
                    <li key={entry.filename}>
                      <a href={entry.url} download title={entry.filename}>{entry.filename.replace(/^denoise-/, '')}</a>
                      <span>{megabytes(entry.bytes)}</span>
                      <button type="button" onClick={() => onDeleteExport(entry.filename)} title="Delete this file from gif_studio/exports"><Trash2 size={13} /></button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
