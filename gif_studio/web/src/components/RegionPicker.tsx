import { REGION_NAMES } from '../lib/mazeStats'

/** Nine-zone picker for where an endpoint sits. No selection means "anywhere". */
export function RegionPicker({ label, tone, selected, onToggle }: {
  label: string
  tone: 'start' | 'goal'
  selected: Set<number>
  onToggle: (region: number) => void
}) {
  return (
    <div className={`region-picker region-picker--${tone}`}>
      <span className="region-picker__label">{label}</span>
      <div className="region-grid" role="group" aria-label={`${label} zones`}>
        {REGION_NAMES.map((name, region) => (
          <button
            key={region}
            type="button"
            aria-pressed={selected.has(region)}
            className={selected.has(region) ? 'is-on' : ''}
            title={`${label} in the ${name}`}
            onClick={() => onToggle(region)}
          />
        ))}
      </div>
    </div>
  )
}
