import HelpCircle from 'lucide-react/dist/esm/icons/circle-help'
import type { ReactNode } from 'react'

export function Tip({ children }: { children: string }) {
  return <span className="tip" title={children} aria-label={children}><HelpCircle size={13} /></span>
}

export function Field({ label, tip, children, vertical = false }: {
  label: string
  tip?: string
  children: ReactNode
  vertical?: boolean
}) {
  return (
    <div className={`field ${vertical ? 'field--vertical' : ''}`}>
      <span className="field__label">{label}{tip ? <Tip>{tip}</Tip> : null}</span>
      <span className="field__control">{children}</span>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <span className="color-input">
      <input type="color" value={value} onChange={event => onChange(event.target.value)} />
      <input value={value.toUpperCase()} onChange={event => onChange(event.target.value)} maxLength={7} />
    </span>
  )
}
