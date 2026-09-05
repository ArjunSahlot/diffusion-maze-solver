import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down'
import Filter from 'lucide-react/dist/esm/icons/funnel'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw'
import Radar from 'lucide-react/dist/esm/icons/radar'
import Search from 'lucide-react/dist/esm/icons/search'
import X from 'lucide-react/dist/esm/icons/x'
import { useDeferredValue, useMemo, useState } from 'react'
import type { FrameLayout, MazeRecord, ScanJob } from '../types'
import { MAX_DISTANCE, mazeStats } from '../lib/mazeStats'
import { mergeRange, mergeZones, parseMazeQuery, type Range, type RunFilter } from '../lib/mazeSearch'
import { MazeThumbnail } from './MazeThumbnail'
import { RangeSlider } from './RangeSlider'
import { RegionPicker } from './RegionPicker'
import { Tip } from './Controls'

type SortKey = 'index' | 'settle' | 'distance' | 'length' | 'turns' | 'coverage' | 'decisions' | 'avoided'

interface Filters {
  start: number[]
  goal: number[]
  eitherWay: boolean
  distance: Range
  length: Range
  turns: Range
  coverage: Range
  settle: Range
  decisions: Range
  avoided: Range
  run: RunFilter
}

const EMPTY: Filters = {
  start: [], goal: [], eitherWay: true,
  distance: [0, MAX_DISTANCE], length: [0, 300], turns: [0, 90], coverage: [0, 100], settle: [0, 999],
  decisions: [0, 40], avoided: [0, 50],
  run: 'all',
}

const PRESETS: { label: string; title: string; ranges?: boolean; patch: Partial<Filters> }[] = [
  { label: 'Corners', title: 'Top left ↔ bottom right', patch: { start: [0], goal: [8], eitherWay: true } },
  { label: 'Far', title: 'Endpoints at least 24 cells apart', ranges: true, patch: { distance: [24, MAX_DISTANCE] } },
  { label: 'Opposite', title: 'One end on the left edge, the other on the right', patch: { start: [0, 3, 6], goal: [2, 5, 8], eitherWay: true } },
  { label: 'Top ↔ bottom', title: 'One end on the top edge, the other on the bottom', patch: { start: [0, 1, 2], goal: [6, 7, 8], eitherWay: true } },
  { label: 'Long', title: 'Solutions of 130 cells or more', ranges: true, patch: { length: [130, 300] } },
  { label: 'Twisty', title: '40 turns or more', ranges: true, patch: { turns: [40, 90] } },
  { label: 'Fills', title: 'Path covers at least 55% of open cells', ranges: true, patch: { coverage: [55, 100] } },
  { label: 'Late', title: 'Path still changing past t = 500', ranges: true, patch: { settle: [0, 500] } },
  { label: 'Decisions', title: 'At least 6 junctions where a wrong turn was possible', ranges: true, patch: { decisions: [6, 40] } },
]

const RUN_FILTERS: { key: RunFilter; label: string; title: string }[] = [
  { key: 'all', label: 'All', title: 'Every candidate' },
  { key: 'valid', label: 'SOLVED', title: 'The model produced a valid path' },
  { key: 'failed', label: 'FAILED', title: 'The model produced an invalid path' },
  { key: 'unseen', label: 'New', title: 'Not run through the model yet' },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'index', label: 'Gallery order' },
  { key: 'distance', label: 'Furthest apart' },
  { key: 'length', label: 'Longest path' },
  { key: 'turns', label: 'Most turns' },
  { key: 'coverage', label: 'Fills most' },
  { key: 'settle', label: 'Settles latest' },
  { key: 'decisions', label: 'Most right decisions' },
  { key: 'avoided', label: 'Most wrong turns skipped' },
]

const isFull = (range: Range, base: Range) => range[0] <= base[0] && range[1] >= base[1]

function activeCount(filters: Filters): number {
  return [
    filters.start.length > 0,
    filters.goal.length > 0,
    !isFull(filters.distance, EMPTY.distance),
    !isFull(filters.length, EMPTY.length),
    !isFull(filters.turns, EMPTY.turns),
    !isFull(filters.coverage, EMPTY.coverage),
    !isFull(filters.settle, EMPTY.settle),
    !isFull(filters.decisions, EMPTY.decisions),
    !isFull(filters.avoided, EMPTY.avoided),
    filters.run !== 'all',
  ].filter(Boolean).length
}

const matchesPreset = (filters: Filters, patch: Partial<Filters>) =>
  Object.entries(patch).every(([key, wanted]) =>
    JSON.stringify(filters[key as keyof Filters]) === JSON.stringify(wanted))

export function MazeBrowser({ mazes, selected, pickedIds, layout, seed, count, loading, scan, onSeed, onCount, onGenerate, onSelect, onFillGrid, onScan, onCancelScan }: {
  mazes: MazeRecord[]
  selected: MazeRecord | null
  pickedIds: (string | null)[]
  layout: FrameLayout
  seed: number
  count: number
  loading: boolean
  scan: ScanJob | null
  onSeed: (value: number) => void
  onCount: (value: number) => void
  onGenerate: () => void
  onSelect: (maze: MazeRecord) => void
  onFillGrid: (mazes: MazeRecord[]) => void
  onScan: () => void
  onCancelScan: () => void
}) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [sort, setSort] = useState<SortKey>('decisions')
  const [rangesOpen, setRangesOpen] = useState(false)
  const scanning = scan?.status === 'running'
  const patch = (next: Partial<Filters>) => setFilters(current => ({ ...current, ...next }))
  const toggleZone = (side: 'start' | 'goal', region: number) => setFilters(current => ({
    ...current,
    [side]: current[side].includes(region) ? current[side].filter(item => item !== region) : [...current[side], region],
  }))

  const stats = useMemo(() => new Map(mazes.map(maze => [maze.id, mazeStats(maze)])), [mazes])
  const search = useMemo(() => parseMazeQuery(deferredQuery), [deferredQuery])

  const filtered = useMemo(() => {
    const start = new Set(mergeZones(filters.start, search.start))
    const goal = new Set(mergeZones(filters.goal, search.goal))
    const eitherWay = filters.eitherWay && search.eitherWay
    const distance = mergeRange(filters.distance, search.distance)
    const length = mergeRange(filters.length, search.length)
    const turns = mergeRange(filters.turns, search.turns)
    const coverage = mergeRange(filters.coverage, search.coverage)
    const settle = mergeRange(filters.settle, search.settle)
    const decisions = mergeRange(filters.decisions, search.decisions)
    const avoided = mergeRange(filters.avoided, search.avoided)
    const run = search.run && filters.run === 'all' ? search.run : filters.run
    if (search.run && filters.run !== 'all' && search.run !== filters.run) return []
    const zoneOk = (zones: Set<number>, region: number) => !zones.size || zones.has(region)
    const inside = (range: Range, input: number) => input >= range[0] && input <= range[1]
    const needle = search.mazeNumber

    const kept = mazes.filter(maze => {
      const item = stats.get(maze.id)!
      if (needle && !String(maze.index + 1).includes(needle)) return false
      if (!inside(distance, item.distance)) return false
      if (!inside(length, maze.pathLength)) return false
      if (!inside(turns, maze.turns)) return false
      if (!inside(coverage, item.coverage)) return false
      if (maze.settleT !== null && !inside(settle, maze.settleT)) return false
      if (!inside(decisions, item.decisions)) return false
      if (!inside(avoided, item.avoided)) return false
      if (run === 'valid' && maze.valid !== true) return false
      if (run === 'failed' && maze.valid !== false) return false
      if (run === 'unseen' && maze.cachedRuns) return false
      const forward = zoneOk(start, item.startRegion) && zoneOk(goal, item.goalRegion)
      const reverse = zoneOk(start, item.goalRegion) && zoneOk(goal, item.startRegion)
      return forward || (eitherWay && reverse)
    })

    const rank: Record<SortKey, (maze: MazeRecord) => number> = {
      index: maze => -maze.index,
      settle: maze => -(maze.settleT ?? 9999),
      distance: maze => stats.get(maze.id)!.distance,
      length: maze => maze.pathLength,
      turns: maze => maze.turns,
      coverage: maze => stats.get(maze.id)!.coverage,
      decisions: maze => stats.get(maze.id)!.decisions,
      avoided: maze => stats.get(maze.id)!.avoided,
    }
    return kept.toSorted((a, b) => rank[sort](b) - rank[sort](a))
  }, [filters, mazes, search, sort, stats])

  const active = activeCount(filters) + search.chips.length
  const rangeActive = [
    !isFull(filters.distance, EMPTY.distance),
    !isFull(filters.length, EMPTY.length),
    !isFull(filters.turns, EMPTY.turns),
    !isFull(filters.coverage, EMPTY.coverage),
    !isFull(filters.settle, EMPTY.settle),
    !isFull(filters.decisions, EMPTY.decisions),
    !isFull(filters.avoided, EMPTY.avoided),
  ].filter(Boolean).length

  return (
    <aside className="maze-browser">
      <div className="panel-heading">
        <span>Mazes</span>
        <span className="panel-heading__meta">{filtered.length}/{mazes.length}</span>
      </div>
      <div className="seed-row">
        <label><span>Seed</span><input type="number" value={seed} min={0} onChange={event => onSeed(Number(event.target.value))} /></label>
        <label><span>Pool</span>
          <select value={count} onChange={event => onCount(Number(event.target.value))} disabled={scanning}>
            {[48, 96, 160, 240, 400].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" className="button button--primary" onClick={onGenerate} disabled={loading || scanning} title="Build a fresh pool from this seed">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="scan-row">
        {scanning ? (
          <>
            <div className="scan-progress"><span style={{ width: `${(scan.done / Math.max(scan.total, 1)) * 100}%` }} /></div>
            <span className="scan-count">{Math.floor(scan.done)}/{scan.total}</span>
            <button type="button" className="icon-button" onClick={onCancelScan} title="Stop scanning"><X size={14} /></button>
          </>
        ) : (
          <button type="button" className="button button--scan" onClick={onScan} disabled={loading}>
            <Radar size={14} /> Scan pool
            <Tip>Runs every maze through the model in GPU batches and caches the results. After that, picking a maze is instant and you can filter by solved or failed.</Tip>
          </button>
        )}
      </div>
      {scan?.status === 'error' ? <p className="inline-warning">{scan.error}</p> : null}

      <div className="search-row">
        <Search size={15} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="far apart, top left → bottom right"
          aria-label="Search mazes"
        />
        {query ? (
          <button type="button" className="search-clear" onClick={() => setQuery('')} title="Clear search"><X size={13} /></button>
        ) : null}
        <button
          type="button"
          className={rangesOpen ? 'is-active' : ''}
          onClick={() => setRangesOpen(value => !value)}
          title="Distance, length, turns, coverage, settle, decisions"
        >
          <Filter size={15} />{active ? <i className="filter-badge">{active}</i> : null}
        </button>
      </div>
      {search.chips.length ? (
        <div className="search-chips" aria-label="Understood from search">
          {search.chips.map(chip => <span key={chip}>{chip}</span>)}
        </div>
      ) : null}

      <div className="chip-row">
        {PRESETS.map(preset => (
          <button
            key={preset.label}
            type="button"
            title={preset.title}
            className={matchesPreset(filters, preset.patch) ? 'is-on' : ''}
            onClick={() => {
              patch(matchesPreset(filters, preset.patch)
                ? Object.fromEntries(Object.keys(preset.patch).map(key => [key, EMPTY[key as keyof Filters]]))
                : preset.patch)
              if (preset.ranges) setRangesOpen(true)
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="zone-row">
        <RegionPicker label="Start" tone="start" selected={new Set(filters.start)} onToggle={region => toggleZone('start', region)} />
        <button
          type="button"
          className={`zone-link ${filters.eitherWay ? 'is-on' : ''}`}
          onClick={() => patch({ eitherWay: !filters.eitherWay })}
          title={filters.eitherWay ? 'Either direction' : 'This exact order'}
        >
          {filters.eitherWay ? <ArrowLeftRight size={13} /> : <ArrowRight size={13} />}
        </button>
        <RegionPicker label="Goal" tone="goal" selected={new Set(filters.goal)} onToggle={region => toggleZone('goal', region)} />
      </div>

      <div className="chip-row chip-row--run">
        {RUN_FILTERS.map(item => (
          <button key={item.key} type="button" title={item.title}
            className={`${filters.run === item.key ? 'is-on' : ''} ${item.key === 'valid' ? 'is-solved' : ''} ${item.key === 'failed' ? 'is-failed' : ''}`}
            onClick={() => patch({ run: item.key })}>
            {item.label}
          </button>
        ))}
      </div>

      {rangesOpen ? (
        <div className="maze-filters">
          <RangeSlider label="Apart" min={0} max={MAX_DISTANCE} value={filters.distance} onChange={distance => patch({ distance })}
            title="How far the endpoints are from each other, in cells." />
          <RangeSlider label="Path" min={0} max={300} step={5} value={filters.length} onChange={length => patch({ length })}
            title="Length of the true solution, in cells." />
          <RangeSlider label="Turns" min={0} max={90} value={filters.turns} onChange={turns => patch({ turns })}
            title="Corners along the solution." />
          <RangeSlider label="Fills" min={0} max={100} suffix="%" value={filters.coverage} onChange={coverage => patch({ coverage })}
            title="Share of open cells the solution walks through." />
          <RangeSlider label="Settles" min={0} max={999} step={5} value={filters.settle} onChange={settle => patch({ settle })}
            title="Last timestep the prediction still changed. Low values keep moving until the end. Only known after a scan." />
          <RangeSlider label="Decisions" min={0} max={40} value={filters.decisions} onChange={decisions => patch({ decisions })}
            title="Junctions where a wrong turn was possible. Walking a corridor does not count." />
          <RangeSlider label="Avoided" min={0} max={50} value={filters.avoided} onChange={avoided => patch({ avoided })}
            title="Wrong exits the path skipped. A 4-way junction counts as two; a T counts as one." />
        </div>
      ) : null}

      <div className={`filter-footer ${layout === 'grid3' ? 'filter-footer--grid' : ''}`}>
        <select value={sort} onChange={event => setSort(event.target.value as SortKey)} aria-label="Sort mazes">
          {SORTS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        {layout === 'grid3' ? (
          <button
            type="button"
            onClick={() => onFillGrid(filtered.slice(0, 9))}
            disabled={!filtered.length}
            title="Put the first nine mazes in the current gallery order into the 3×3"
          >
            Fill 3×3
          </button>
        ) : null}
        <button type="button" onClick={() => { setFilters(EMPTY); setQuery('') }} disabled={!active}>Clear</button>
      </div>
      {!rangesOpen && rangeActive ? (
        <button type="button" className="ranges-hint" onClick={() => setRangesOpen(true)}>
          <ChevronDown size={12} /> {rangeActive} range{rangeActive === 1 ? '' : 's'} active
        </button>
      ) : null}

      <div className="maze-gallery">
        {filtered.map(maze => (
          <MazeThumbnail
            key={maze.id}
            maze={maze}
            stats={stats.get(maze.id)!}
            selected={selected?.id === maze.id}
            slot={(pickedIds.findIndex(id => id === maze.id) + 1) || undefined}
            onSelect={() => onSelect(maze)}
          />
        ))}
        {!filtered.length && !loading ? <div className="empty-gallery">Nothing matches. Clear search or filters.</div> : null}
      </div>
    </aside>
  )
}
