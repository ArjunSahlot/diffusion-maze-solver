"use client";

import { useCallback, useEffect, useState } from "react";

import {
  at,
  blankGrid,
  completeMaze,
  decodePath,
  encodeState,
  findPath,
  isValidSolution,
  randomMaze,
  seededRandom,
  type Cell,
  type Grid,
} from "@/lib/maze";
import { useSolver } from "@/lib/useSolver";
import { Board } from "./Board";
import { Button, Segmented } from "./ui";

type Tool = "wall" | "erase" | "start" | "goal";
type Puzzle = { grid: Grid; start: Cell; goal: Cell };
type Result = { valid: boolean; length: number; shortest: number | null };

const STEP_CHOICES = ["16", "32", "64"] as const;
const CURSORS: Record<Tool, string> = { wall: "crosshair", erase: "crosshair", start: "pointer", goal: "pointer" };

/** Glyphs mirror how each thing is drawn on the board, so the legend is the toolbar itself. */
const GLYPHS: Record<Tool, React.ReactNode> = {
  wall: <rect width="12" height="12" rx="1" fill="currentColor" />,
  erase: <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />,
  start: <rect x="3" y="3" width="6" height="6" fill="currentColor" />,
  goal: <rect x="3.75" y="3.75" width="4.5" height="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />,
};

const TOOLS: { value: Tool; label: string; title: string }[] = [
  { value: "wall", label: "Wall", title: "Draw walls (1)" },
  { value: "erase", label: "Erase", title: "Open up corridors (2)" },
  { value: "start", label: "Start", title: "Move the start (3)" },
  { value: "goal", label: "Goal", title: "Move the goal (4)" },
];

const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

export function Playground() {
  // Seeded so the server and the client agree on the first maze; every later maze is random.
  const [puzzle, setPuzzle] = useState<Puzzle>(() => randomMaze(seededRandom(7)));
  const [tool, setTool] = useState<Tool>("wall");
  const [steps, setSteps] = useState(32);
  const [result, setResult] = useState<Result | null>(null);

  const onSettled = useCallback(
    (prediction: Float32Array) => {
      const { grid, start, goal } = puzzle;
      const path = decodePath(prediction);
      setResult({
        valid: isValidSolution(grid, path, start, goal),
        length: path.length,
        shortest: findPath(grid, start, goal)?.length ?? null,
      });
    },
    [puzzle],
  );

  const { status, prediction, progress, running, solve, cancel } = useSolver(onSettled);

  const invalidate = useCallback(() => {
    setResult(null);
    cancel();
  }, [cancel]);

  const showing = running || prediction !== null || result !== null;
  const edit = useCallback(
    (next: (previous: Puzzle) => Puzzle) => {
      if (showing) invalidate();
      setPuzzle(next);
    },
    [showing, invalidate],
  );

  const paint = useCallback(
    (r: number, c: number) => {
      edit((previous) => {
        const target: Cell = [r, c];
        if (tool === "start" || tool === "goal") {
          if (sameCell(target, tool === "start" ? previous.goal : previous.start)) return previous;
          const grid = Uint8Array.from(previous.grid);
          grid[at(r, c)] = 1; // an endpoint always sits on open ground
          return tool === "start" ? { ...previous, grid, start: target } : { ...previous, grid, goal: target };
        }
        const open = tool === "erase";
        // Walling over an endpoint would hand the model an impossible board.
        if (!open && (sameCell(target, previous.start) || sameCell(target, previous.goal))) return previous;
        if (Boolean(previous.grid[at(r, c)]) === open) return previous;
        const grid = Uint8Array.from(previous.grid);
        grid[at(r, c)] = open ? 1 : 0;
        return { ...previous, grid };
      });
    },
    [edit, tool],
  );

  const fill = useCallback(
    () => edit((previous) => ({ ...previous, grid: completeMaze(Uint8Array.from(previous.grid)) })),
    [edit],
  );
  const shuffle = useCallback(() => edit(() => randomMaze()), [edit]);
  const clear = useCallback(
    () =>
      edit((previous) => {
        const grid = blankGrid();
        grid[at(previous.start[0], previous.start[1])] = 1;
        grid[at(previous.goal[0], previous.goal[1])] = 1;
        return { ...previous, grid };
      }),
    [edit],
  );

  const run = useCallback(() => {
    if (running) {
      cancel();
      return;
    }
    setResult(null);
    solve(encodeState(puzzle.grid, puzzle.start, puzzle.goal), steps);
  }, [running, cancel, solve, steps, puzzle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const shortcuts: Record<string, () => void> = {
        "1": () => setTool("wall"),
        "2": () => setTool("erase"),
        "3": () => setTool("start"),
        "4": () => setTool("goal"),
        f: fill,
        n: shuffle,
        c: clear,
        Enter: run,
      };
      const action = shortcuts[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fill, shuffle, clear, run]);

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
          onPaint={paint}
          cursor={CURSORS[tool]}
          label="Editable 23 by 23 maze"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-px bottom-px h-[3px] overflow-hidden rounded-b-lg"
        >
          <div
            className="h-full bg-accent transition-[width,opacity] duration-200 ease-out"
            style={{ width: `${bar * 100}%`, opacity: bar > 0 && bar < 1 ? 1 : 0 }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Segmented
          aria-label="Drawing tool"
          value={tool}
          onChange={setTool}
          className="h-9 sm:flex-1"
          options={TOOLS.map(({ value, label, title }) => ({
            value,
            title,
            label: (
              <>
                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0" aria-hidden>
                  {GLYPHS[value]}
                </svg>
                {label}
              </>
            ),
          }))}
        />
        <div className="flex gap-2">
          <Button onClick={fill} title="Complete the maze from what you drew (F)" className="flex-1 sm:flex-none">
            Fill
          </Button>
          <Button onClick={shuffle} title="Generate a new random maze (N)" className="flex-1 sm:flex-none">
            New
          </Button>
          <Button onClick={clear} title="Wipe the board (C)" className="flex-1 sm:flex-none">
            Clear
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={run}
          title="Run the model (Enter)"
          className="h-10 flex-1 text-[0.9375rem]"
        >
          {running ? "Stop" : "Solve"}
        </Button>
        <Segmented
          aria-label="Denoising steps"
          value={String(steps) as (typeof STEP_CHOICES)[number]}
          onChange={(value) => setSteps(Number(value))}
          options={STEP_CHOICES.map((value) => ({ value, title: `${value} denoising steps` }))
            .map(({ value, title }) => ({ value, title, label: <span className="tabular-nums">{value}</span> }))}
          className="h-10 shrink-0"
        />
      </div>

      <Status status={status} running={running} progress={progress} steps={steps} result={result} />
    </div>
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

  let text: React.ReactNode = "Ready";
  if (status.phase === "failed") text = status.message ?? "The model could not be loaded";
  else if (status.phase === "downloading")
    text = `Loading model — ${megabytes(status.received)} / ${megabytes(status.total)} MB`;
  else if (status.phase === "preparing") text = "Preparing the model";
  else if (status.phase === "starting") text = "Loading model";
  else if (running) text = `Denoising — step ${Math.max(1, Math.round(progress * steps))} of ${steps}`;
  else if (result)
    text = result.valid ? (
      <>
        Solved — {result.length} cells{result.shortest === result.length ? ", the shortest route" : `, shortest is ${result.shortest}`}
      </>
    ) : (
      <>Not a solution — the path breaks before it connects the endpoints</>
    );
  else text = `Ready — running on ${status.backend}`;

  return (
    <p
      className={`font-mono text-[0.8125rem] leading-5 ${
        status.phase === "failed" || result?.valid === false ? "text-foreground" : "text-muted"
      }`}
      aria-live="polite"
    >
      {text}
    </p>
  );
}
