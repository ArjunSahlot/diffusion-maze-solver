/**
 * Canvas rendering for the maze, the model's in-progress guess, and the reference route.
 *
 * `size` is in device pixels and every boundary is rounded to a whole one, so the board
 * stays crisp at fractional device pixel ratios and at whatever width the layout gives it.
 * Colours come from the CSS tokens rather than a second copy in TypeScript, so the board
 * and the page can never drift apart.
 */

import { GRID, FULL, type Cell, type Grid, at } from "./maze";

export interface Palette {
  open: string;
  wall: string;
  path: string;
  start: string;
  goal: string;
  optimal: string;
}

export function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    open: token("--maze-open"),
    wall: token("--maze-wall"),
    path: token("--maze-path"),
    start: token("--maze-start"),
    goal: token("--maze-goal"),
    optimal: token("--maze-optimal"),
  };
}

export interface Board {
  grid: Grid;
  start: Cell;
  goal: Cell;
  /** The path channel over a FULL x FULL frame, values in [-1, 1], or null when unsolved. */
  prediction: Float32Array | null;
  /** The shortest route, drawn as a reference trace when the user asks for it. */
  optimal: Cell[] | null;
}

export function drawMaze(ctx: CanvasRenderingContext2D, size: number, board: Board, palette: Palette) {
  const edge = (i: number) => Math.round((i * size) / GRID);
  const { grid, start, goal, prediction, optimal } = board;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = palette.open;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = palette.wall;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (grid[at(r, c)]) continue;
      // Merge runs of wall into one rect so we issue a fraction of the fills.
      let end = c;
      while (end + 1 < GRID && !grid[at(r, end + 1)]) end++;
      ctx.fillRect(edge(c), edge(r), edge(end + 1) - edge(c), edge(r + 1) - edge(r));
      c = end;
    }
  }

  // The model guesses the path over the whole frame, walls included, and only resolves it
  // onto the corridors as it denoises. Drawing the raw field is the honest picture of that.
  if (prediction) {
    ctx.fillStyle = palette.path;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const strength = (Math.min(1, Math.max(-1, prediction[r * FULL + c])) + 1) / 2;
        if (strength < 0.02) continue;
        ctx.globalAlpha = strength;
        ctx.fillRect(edge(c), edge(r), edge(c + 1) - edge(c), edge(r + 1) - edge(r));
      }
    }
    ctx.globalAlpha = 1;
  }

  const cell = size / GRID;

  if (optimal) {
    const dot = Math.max(2, cell * 0.34);
    ctx.fillStyle = palette.optimal;
    for (const [r, c] of optimal) {
      ctx.fillRect(edge(c) + (cell - dot) / 2, edge(r) + (cell - dot) / 2, dot, dot);
    }
  }

  // Endpoints sit on a clean plate so they stay readable once the path is drawn over them.
  const inset = Math.max(1.5, cell * 0.24);
  for (const [r, c] of [start, goal]) {
    ctx.fillStyle = palette.open;
    ctx.fillRect(edge(c), edge(r), edge(c + 1) - edge(c), edge(r + 1) - edge(r));
  }

  // Start is solid, goal is a ring: the shapes hold up even where the colours do not.
  ctx.fillStyle = palette.start;
  ctx.fillRect(edge(start[1]) + inset, edge(start[0]) + inset, cell - 2 * inset, cell - 2 * inset);
  ctx.strokeStyle = palette.goal;
  ctx.lineWidth = Math.max(1.5, cell * 0.17);
  ctx.strokeRect(
    edge(goal[1]) + inset + ctx.lineWidth / 2,
    edge(goal[0]) + inset + ctx.lineWidth / 2,
    cell - 2 * inset - ctx.lineWidth,
    cell - 2 * inset - ctx.lineWidth,
  );
}
