import Link from 'lucide-react/dist/esm/icons/link'
import Unlink from 'lucide-react/dist/esm/icons/unlink'
import { useState } from 'react'
import type { AppearanceConfig, TextConfig } from '../types'
import { withPad } from '../lib/draw'
import { Toggle } from './Controls'

type Side = 'padTop' | 'padRight' | 'padBottom' | 'padLeft'
const SIDES: { key: Side; label: string }[] = [
  { key: 'padTop', label: 'Top' },
  { key: 'padRight', label: 'Right' },
  { key: 'padBottom', label: 'Bottom' },
  { key: 'padLeft', label: 'Left' },
]

/** Frame around the maze, in output pixels. Linked edits all four sides at once. */
export function PaddingInput({ appearance, text, onChange }: {
  appearance: AppearanceConfig
  text: TextConfig
  onChange: (patch: Partial<AppearanceConfig>) => void
}) {
  const values = SIDES.map(side => appearance[side.key])
  const effective = withPad(appearance, text)
  const [linked, setLinked] = useState(new Set(values).size === 1)
  const limit = Math.floor(appearance.resolution / 2) - 8
  const clamp = (input: number) => Math.max(0, Math.min(limit, Math.round(input) || 0))
  const bumped = SIDES.some(side => effective[side.key] !== appearance[side.key])

  return (
    <div className="padding-input">
      <div className="padding-input__head">
        <span>Keep text off maze</span>
        <Toggle checked={appearance.autoPad} onChange={autoPad => onChange({ autoPad })} label="Keep counter off the maze" />
      </div>
      <div className="padding-input__head">
        <span>Frame padding</span>
        <button
          type="button"
          className={linked ? 'is-on' : ''}
          onClick={() => {
            if (!linked) onChange(Object.fromEntries(SIDES.map(side => [side.key, values[0]])))
            setLinked(value => !value)
          }}
          title={linked ? 'All four sides move together' : 'Each side is set on its own'}
        >
          {linked ? <Link size={12} /> : <Unlink size={12} />}
        </button>
      </div>
      {linked ? (
        <div className="input-suffix">
          <input
            type="number" min={0} max={limit} step={4} value={values[0]}
            onChange={event => onChange(Object.fromEntries(SIDES.map(side => [side.key, clamp(Number(event.target.value))])))}
          />
          <span>px</span>
        </div>
      ) : (
        <div className="padding-grid">
          {SIDES.map((side, index) => (
            <label key={side.key}>
              <span>{side.label}{bumped && effective[side.key] !== values[index] ? ` → ${effective[side.key]}` : ''}</span>
              <input type="number" min={0} max={limit} step={4} value={values[index]}
                onChange={event => onChange({ [side.key]: clamp(Number(event.target.value)) })} />
            </label>
          ))}
        </div>
      )}
      {linked && bumped ? <p className="padding-effective">Applied {effective.padTop} / {effective.padRight} / {effective.padBottom} / {effective.padLeft} px</p> : null}
    </div>
  )
}
