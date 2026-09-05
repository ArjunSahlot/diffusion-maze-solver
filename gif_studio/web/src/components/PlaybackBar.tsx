import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right'
import Pause from 'lucide-react/dist/esm/icons/pause'
import Play from 'lucide-react/dist/esm/icons/play'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw'
import SkipBack from 'lucide-react/dist/esm/icons/skip-back'
import SkipForward from 'lucide-react/dist/esm/icons/skip-forward'

export function PlaybackBar({ playing, frame, frames, timestep, fps, loop, onPlaying, onFrame, onLoop }: {
  playing: boolean
  frame: number
  frames: number
  timestep: number
  fps: number
  loop: boolean
  onPlaying: (value: boolean) => void
  onFrame: (frame: number) => void
  onLoop: (value: boolean) => void
}) {
  const step = (delta: number) => onFrame(Math.max(0, Math.min(frames - 1, frame + delta)))
  return (
    <div className="playback-bar">
      <div className="transport">
        <button type="button" onClick={() => onFrame(0)} title="First frame"><SkipBack size={15} /></button>
        <button type="button" onClick={() => step(-1)} title="Previous frame"><ChevronLeft size={16} /></button>
        <button type="button" className="transport__play" onClick={() => onPlaying(!playing)} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button type="button" onClick={() => step(1)} title="Next frame"><ChevronRight size={16} /></button>
        <button type="button" onClick={() => onFrame(frames - 1)} title="Last frame"><SkipForward size={15} /></button>
      </div>
      <div className="playback-readout">
        <strong>Frame {frame + 1}</strong><span>/ {frames}</span><i />
        <code>t = {timestep}</code><i />
        <span>{(frame / fps).toFixed(2)}s</span>
      </div>
      <div className="playback-actions">
        <button type="button" className={loop ? 'is-active' : ''} onClick={() => onLoop(!loop)} title="Loop preview"><RotateCcw size={14} /></button>
      </div>
    </div>
  )
}
