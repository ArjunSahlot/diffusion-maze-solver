"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ALGORITHMS,
  at,
  completeMaze,
  decodePath,
  encodeState,
  findPath,
  isValidSolution,
  openGrid,
  randomMaze,
  seededRandom,
  type Algorithm,
  type Cell,
  type Grid,
} from "@/lib/maze";
import { useSolver } from "@/lib/useSolver";
import { Board, type Marker } from "./Board";
import { Button, IconButton, Segmented, Select } from "./ui";

type Tool = "wall" | "erase";
type Puzzle = { grid: Grid; start: Cell; goal: Cell };
type Result = { valid: boolean; length: number; shortest: number | null };

const STEP_CHOICES = ["16", "32", "64"] as const;
const HISTORY_LIMIT = 60;

const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const samePuzzle = (a: Puzzle, b: Puzzle) =>
  sameCell(a.start, b.start) && sameCell(a.goal, b.goal) && a.grid.every((value, i) => value === b.grid[i]);

const TOOLS: { value: Tool; label: string; title: string; glyph: React.ReactNode }[] = [
  {
    value: "wall",
    label: "Wall",
    title: "Draw walls (1)",
    glyph: <rect width="12" height="12" rx="1.5" fill="currentColor" />,
  },
  {
    value: "erase",
    label: "Erase",
    title: "Open up corridors (2)",
    glyph: <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  },
];

export function Playground() {
  // Seeded so the server and the client agree on the first maze; every later maze is random.
  const [puzzle, setPuzzle] = useState<Puzzle>(() => randomMaze("backtracker", seededRandom(7)));
  const [history, setHistory] = useState<Puzzle[]>([]);
  const [future, setFuture] = useState<Puzzle[]>([]);
  const [tool, setTool] = useState<Tool>("wall");
  const [algorithm, setAlgorithm] = useState<Algorithm>("backtracker");
  const [steps, setSteps] = useState(32);
  const [result, setResult] = useState<Result | null>(null);
  const [showOptimal, setShowOptimal] = useState(false);
  // The model only ever saw recursive-backtracker mazes, so anything drawn by hand or laid
  // out by another generator is off-distribution and worth saying so before it disappoints.
  const [offDistribution, setOffDistribution] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const optimal = useMemo(() => findPath(puzzle.grid, puzzle.start, puzzle.goal), [puzzle]);

  const onSettled = useCallback(
    (prediction: Float32Array) => {
      const path = decodePath(prediction);
      setResult({
        valid: isValidSolution(puzzle.grid, path, puzzle.start, puzzle.goal),
        length: path.length,
        shortest: optimal?.length ?? null,
      });
    },
    [puzzle, optimal],
  );

  const { status, prediction, progress, running, solve, cancel } = useSolver(onSettled);
  const showing = running || prediction !== null || result !== null;

  /**
   * A stroke can paint many pixels across many events, so the board it started from is
   * captured once here and pushed as a single undo step.
   */
  const record = useCallback(
    (marker: Marker | null = null) => {
      setHistory((entries) => [...entries.slice(-(HISTORY_LIMIT - 1)), puzzle]);
      setFuture([]);
      // Endpoints landed anywhere are still in distribution; changed walls are not.
      if (!marker) setOffDistribution(true);
      if (showing) {
        setResult(null);
        cancel();
      }
    },
    [puzzle, showing, cancel],
  );

  const travel = useCallback(
    (from: Puzzle[], setFrom: typeof setHistory, setTo: typeof setFuture) => {
      // A stroke that changed nothing still recorded a step; skip over those silently.
      let entries = from;
      while (entries.length && samePuzzle(entries[entries.length - 1], puzzle)) entries = entries.slice(0, -1);
      if (!entries.length) {
        setFrom(entries);
        return;
      }
      setTo((other) => [...other, puzzle]);
      setPuzzle(entries[entries.length - 1]);
      setFrom(entries.slice(0, -1));
      setResult(null);
      cancel();
    },
    [puzzle, cancel],
  );

  const undo = useCallback(() => travel(history, setHistory, setFuture), [travel, history]);
  const redo = useCallback(() => travel(future, setFuture, setHistory), [travel, future]);

  const paint = useCallback((r: number, c: number, erase: boolean) => {
    setPuzzle((previous) => {
      const target: Cell = [r, c];
      // Walling over an endpoint would hand the model an impossible board.
      if (!erase && (sameCell(target, previous.start) || sameCell(target, previous.goal))) return previous;
      if (Boolean(previous.grid[at(r, c)]) === erase) return previous;
      const grid = Uint8Array.from(previous.grid);
      grid[at(r, c)] = erase ? 1 : 0;
      return { ...previous, grid };
    });
  }, []);

  const moveMarker = useCallback((marker: Marker, r: number, c: number) => {
    setPuzzle((previous) => {
      const target: Cell = [r, c];
      if (sameCell(target, previous[marker])) return previous;
      if (sameCell(target, marker === "start" ? previous.goal : previous.start)) return previous;
      const grid = Uint8Array.from(previous.grid);
      grid[at(r, c)] = 1; // an endpoint always sits on open ground
      return marker === "start" ? { ...previous, grid, start: target } : { ...previous, grid, goal: target };
    });
  }, []);

  const fill = useCallback(() => {
    record();
    setPuzzle((previous) => ({ ...previous, grid: completeMaze(Uint8Array.from(previous.grid), algorithm) }));
  }, [record, algorithm]);

  const shuffle = useCallback(() => {
    record();
    setOffDistribution(algorithm !== "backtracker");
    setFlagged(false);
    setPuzzle(randomMaze(algorithm));
  }, [record, algorithm]);

  // Clearing knocks every wall down, leaving an open room to build back up from.
  const clear = useCallback(() => {
    record();
    setPuzzle((previous) => ({ ...previous, grid: openGrid() }));
  }, [record]);

  const run = useCallback(() => {
    if (running) {
      cancel();
      return;
    }
    setResult(null);
    setFlagged(offDistribution);
    solve(encodeState(puzzle.grid, puzzle.start, puzzle.goal), steps);
  }, [running, cancel, solve, steps, puzzle, offDistribution]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() !== "z") return;
        event.preventDefault();
        (event.shiftKey ? redo : undo)();
        return;
      }
      if (event.altKey) return;
      const shortcuts: Record<string, () => void> = {
        "1": () => setTool("wall"),
        "2": () => setTool("erase"),
        f: fill,
        n: shuffle,
        c: clear,
        o: () => setShowOptimal((on) => !on),
        Enter: run,
      };
      const action = shortcuts[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fill, shuffle, clear, run, undo, redo]);

  const bar =
    status.phase === "downloading" && status.total ? status.received! / status.total : running ? progress : 0;

  return (
    <div className="flex w-full max-w-[34rem] flex-col gap-3">
      <div className="relative">
        <Board
          grid={puzzle.grid}
          start={puzzle.start}
          goal={puzzle.goal}
          prediction={prediction}
          optimal={showOptimal ? optimal : null}
          onPaint={paint}
          onStrokeStart={record}
          onMoveMarker={moveMarker}
          erasing={tool === "erase"}
          label="Editable 23 by 23 maze"
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-px bottom-px h-[3px] overflow-hidden rounded-b-xl">
          <div
            className="h-full bg-accent transition-[width,opacity] duration-200 ease-out"
            style={{ width: `${bar * 100}%`, opacity: bar > 0 && bar < 1 ? 1 : 0 }}
          />
        </div>
      </div>

      <div className="flex min-h-5 items-baseline justify-between gap-4">
        <Status status={status} running={running} progress={progress} steps={steps} result={result} />
        <button
          type="button"
          onClick={() => setShowOptimal((on) => !on)}
          title="Overlay the shortest route for comparison (O)"
          className="link-quiet flex shrink-0 cursor-pointer items-center gap-1.5 text-[0.8125rem] whitespace-nowrap"
        >
          <span
            aria-hidden
            className="size-2 rounded-[2px] transition-opacity duration-200"
            style={{ background: "var(--maze-optimal)", opacity: showOptimal ? 1 : 0.35 }}
          />
          {showOptimal ? "Hide" : "Show"} shortest
        </button>
      </div>

      {flagged && (
        <p className="flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[0.8125rem] leading-5 text-muted">
          <span aria-hidden className="mt-[0.4rem] size-1.5 shrink-0 rounded-full bg-accent" />
          <span>
            This board was drawn or laid out by another generator. The model was only ever trained on
            recursive-backtracker mazes, so it will often fail here.
          </span>
        </p>
      )}

      <div className="flex gap-2">
        <Segmented
          aria-label="Drawing tool"
          value={tool}
          onChange={setTool}
          className="h-9 flex-1"
          options={TOOLS.map(({ value, label, title, glyph }) => ({
            value,
            title,
            label: (
              <>
                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0" aria-hidden>
                  {glyph}
                </svg>
                {label}
              </>
            ),
          }))}
        />
        <IconButton onClick={undo} disabled={!history.length} title="Undo (⌘Z)" aria-label="Undo">
          <Arrow />
        </IconButton>
        <IconButton onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)" aria-label="Redo">
          <Arrow flipped />
        </IconButton>
        <Button onClick={clear} title="Wipe the board (C)">
          Clear
        </Button>
      </div>

      <div className="flex gap-2">
        <Select
          aria-label="Maze generator"
          value={algorithm}
          onChange={setAlgorithm}
          className="min-w-0 flex-1"
          options={Object.entries(ALGORITHMS).map(([value, { label, note }]) => ({
            value: value as Algorithm,
            label,
            title: note,
          }))}
        />
        <Button onClick={fill} title="Complete the maze around what you drew (F)">
          Fill
        </Button>
        <Button onClick={shuffle} title="Generate a whole new maze (N)">
          New
        </Button>
      </div>

      <div className="flex gap-2">
        <Button variant="primary" onClick={run} title="Run the model (Enter)" className="h-10 flex-1 text-[0.9375rem]">
          {running ? "Stop" : "Solve"}
        </Button>
        <Segmented
          aria-label="Denoising steps"
          value={String(steps) as (typeof STEP_CHOICES)[number]}
          onChange={(value) => setSteps(Number(value))}
          options={STEP_CHOICES.map((value) => ({
            value,
            title: `${value} denoising steps`,
            label: <span className="tabular-nums">{value}</span>,
          }))}
          className="h-10 shrink-0"
        />
      </div>

      <p className="text-[0.8125rem] text-faint">
        Drag either endpoint to move it. Hold <kbd className="font-mono">⇧</kbd> or use the right button to invert the
        brush.
      </p>
    </div>
  );
}

function Arrow({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden
      style={flipped ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M6.5 4 3 7.5l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 7.5h6.25A3.75 3.75 0 0 1 13 11.25v0A3.75 3.75 0 0 1 9.25 15" strokeLinecap="round" />
    </svg>
  );
}

function Status({
  status,
  running,
  progress,
  steps,
  result,
}: {
  status: ReturnType<typeof useSolver>["status"];
  running: boolean;
  progress: number;
  steps: number;
  result: Result | null;
}) {
  const megabytes = (bytes = 0) => (bytes / 1e6).toFixed(1);

  let text: React.ReactNode;
  if (status.phase === "failed") text = status.message ?? "The model could not be loaded";
  else if (status.phase === "downloading")
    text = `Loading model — ${megabytes(status.received)} / ${megabytes(status.total)} MB`;
  else if (status.phase === "preparing") text = "Preparing the model";
  else if (status.phase === "starting") text = "Loading model";
  else if (running) text = `Denoising — step ${Math.max(1, Math.round(progress * steps))} of ${steps}`;
  else if (result)
    text = result.valid ? (
      <>
        Solved — {result.length} cells
        {result.shortest === result.length ? ", the shortest route" : `, shortest is ${result.shortest}`}
      </>
    ) : (
      <>Not a solution — the path never connects the endpoints</>
    );
  else text = `Ready — running on ${status.backend}`;

  return (
    <p
      className={`min-w-0 truncate font-mono text-[0.8125rem] ${
        status.phase === "failed" || result?.valid === false ? "text-fg" : "text-muted"
      }`}
      aria-live="polite"
    >
      {text}
    </p>
  );
}
