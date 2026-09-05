/**
 * Maze representation and algorithms, ported from maze.py so the playground can
 * generate, edit and verify mazes without a server.
 *
 * The grid is GRID x GRID pixels where each pixel is a wall or open. Cells live at
 * odd coordinates and the walls between them at even ones, so the outer border is
 * always wall. The model sees a FULL x FULL frame with the extra row/column padded
 * as wall, exactly as in training.
 */

export const GRID = 23;
export const FULL = 24;
export const CELLS = (GRID - 1) / 2; // 11 x 11 addressable cells

export type Cell = readonly [number, number];
/** GRID*GRID row-major array: 1 = open, 0 = wall. */
export type Grid = Uint8Array;

export const at = (r: number, c: number) => r * GRID + c;
export const isCell = (r: number, c: number) => r % 2 === 1 && c % 2 === 1;
export const inBounds = (r: number, c: number) => r >= 0 && r < GRID && c >= 0 && c < GRID;
/** The border is structural wall and is never editable. */
export const isInterior = (r: number, c: number) => r > 0 && r < GRID - 1 && c > 0 && c < GRID - 1;

export const blankGrid = (): Grid => new Uint8Array(GRID * GRID);

/** Every interior pixel open, with only the border left standing. */
export function openGrid(): Grid {
  const grid = blankGrid();
  for (let r = 1; r < GRID - 1; r++) {
    for (let c = 1; c < GRID - 1; c++) grid[at(r, c)] = 1;
  }
  return grid;
}

export const snapToCell = (r: number, c: number): Cell => [
  Math.min(GRID - 2, Math.max(1, r % 2 === 1 ? r : r - 1)),
  Math.min(GRID - 2, Math.max(1, c % 2 === 1 ? c : c - 1)),
];

const STEP2: Cell[] = [
  [-2, 0],
  [0, -2],
  [0, 2],
  [2, 0],
];
const STEP1: Cell[] = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];

function cellNeighbors(r: number, c: number): Cell[] {
  const out: Cell[] = [];
  for (const [dr, dc] of STEP2) {
    const nr = r + dr;
    const nc = c + dc;
    if (isInterior(nr, nc)) out.push([nr, nc]);
  }
  return out;
}

/** The maze generators offered in the playground, in the order they are shown. */
export const ALGORITHMS = {
  backtracker: {
    label: "Recursive backtracker",
    note: "Long winding corridors and few junctions. The only kind of maze the model was trained on.",
  },
  prim: {
    label: "Randomised Prim",
    note: "Grows from a random frontier, giving short branches and lots of dead ends.",
  },
  kruskal: {
    label: "Randomised Kruskal",
    note: "Joins cells in random order, so passages fan out evenly with no grain to follow.",
  },
} as const;

export type Algorithm = keyof typeof ALGORITHMS;

/** Cells the drawing has already opened. These seed every generator. */
function openedCells(grid: Grid): Set<number> {
  const visited = new Set<number>();
  for (let r = 1; r < GRID - 1; r += 2) {
    for (let c = 1; c < GRID - 1; c += 2) {
      if (grid[at(r, c)]) visited.add(at(r, c));
    }
  }
  return visited;
}

const carve = (grid: Grid, from: number, to: number) => {
  grid[(from + to) / 2] = 1;
  grid[to] = 1;
};

const decode = (node: number): Cell => [Math.floor(node / GRID), node % GRID];

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Start every growth-based generator from the drawing, or from one random cell. */
function seed(grid: Grid, rng: () => number): Set<number> {
  const visited = openedCells(grid);
  if (visited.size === 0) {
    const start = at(1 + 2 * Math.floor(rng() * CELLS), 1 + 2 * Math.floor(rng() * CELLS));
    grid[start] = 1;
    visited.add(start);
  }
  return visited;
}

/**
 * Recursive backtracker: always extend from the most recently reached cell, which is
 * what produces the long corridors of the training set. Whatever is already open counts
 * as visited, so a drawing is extended rather than overwritten.
 */
function carveBacktracker(grid: Grid, rng: () => number): void {
  const visited = seed(grid, rng);
  // Shuffled so the growth front does not always start from the same corner.
  const stack = shuffle([...visited], rng);

  while (visited.size < CELLS * CELLS) {
    while (stack.length) {
      const current = stack[stack.length - 1];
      const [r, c] = decode(current);
      const unvisited = cellNeighbors(r, c).filter(([nr, nc]) => !visited.has(at(nr, nc)));
      if (!unvisited.length) {
        stack.pop();
        continue;
      }
      const [nr, nc] = unvisited[Math.floor(rng() * unvisited.length)];
      carve(grid, current, at(nr, nc));
      visited.add(at(nr, nc));
      stack.push(at(nr, nc));
    }
    // Unreachable on a connected lattice, but keeps the loop total if one is ever passed in.
    for (let r = 1; r < GRID - 1 && visited.size < CELLS * CELLS; r += 2) {
      for (let c = 1; c < GRID - 1; c += 2) {
        if (!visited.has(at(r, c))) {
          grid[at(r, c)] = 1;
          visited.add(at(r, c));
          stack.push(at(r, c));
          break;
        }
      }
    }
  }
}

/**
 * The carve above grows outward from what was already open, so two separate drawings, or a
 * start and goal dropped onto a blank board, each end up with their own tree and no way
 * between them. This knocks down the fewest wall segments needed to make the maze one piece.
 */
function joinComponents(grid: Grid, rng: () => number): void {
  const parent = new Int32Array(GRID * GRID);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (node: number): number => {
    while (parent[node] !== node) node = parent[node] = parent[parent[node]];
    return node;
  };
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra === rb) return false;
    parent[rb] = ra;
    return true;
  };

  for (let r = 1; r < GRID - 1; r++) {
    for (let c = 1; c < GRID - 1; c++) {
      if (!grid[at(r, c)]) continue;
      if (r + 1 < GRID - 1 && grid[at(r + 1, c)]) union(at(r, c), at(r + 1, c));
      if (c + 1 < GRID - 1 && grid[at(r, c + 1)]) union(at(r, c), at(r, c + 1));
    }
  }

  // Randomised Kruskal over the wall segments still standing between two cells.
  const segments: [number, number, number][] = [];
  for (let r = 1; r < GRID - 1; r += 2) {
    for (let c = 1; c < GRID - 1; c += 2) {
      if (c + 2 < GRID - 1) segments.push([at(r, c + 1), at(r, c), at(r, c + 2)]);
      if (r + 2 < GRID - 1) segments.push([at(r + 1, c), at(r, c), at(r + 2, c)]);
    }
  }
  for (const [middle, from, to] of shuffle(segments, rng)) {
    if (union(from, to)) {
      grid[middle] = 1;
      union(middle, from);
    }
  }

  // Every cell is now open and joined, so the only thing that can still be stranded is a
  // junction the user opened by hand with four walls around it. Give each one a way out.
  for (let r = 2; r < GRID - 1; r += 2) {
    for (let c = 2; c < GRID - 1; c += 2) {
      if (!grid[at(r, c)]) continue;
      const around = STEP1.map(([dr, dc]) => [r + dr, c + dc] as Cell).filter(([nr, nc]) => isInterior(nr, nc));
      if (around.some(([nr, nc]) => grid[at(nr, nc)])) continue;
      const [nr, nc] = around[Math.floor(rng() * around.length)];
      grid[at(nr, nc)] = 1;
    }
  }
}

/**
 * Randomised Prim: extend from a uniformly random cell on the frontier rather than the
 * newest one. Same spanning tree in the end, very different texture — short branches and
 * far more dead ends than anything the model saw in training.
 */
function carvePrim(grid: Grid, rng: () => number): void {
  const visited = seed(grid, rng);
  const frontier: [number, number][] = [];
  const extend = (node: number) => {
    const [r, c] = decode(node);
    for (const [nr, nc] of cellNeighbors(r, c)) {
      if (!visited.has(at(nr, nc))) frontier.push([node, at(nr, nc)]);
    }
  };
  for (const node of visited) extend(node);

  while (frontier.length && visited.size < CELLS * CELLS) {
    const pick = Math.floor(rng() * frontier.length);
    const [from, to] = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();
    if (visited.has(to)) continue;
    carve(grid, from, to);
    visited.add(to);
    extend(to);
  }
}

/**
 * Complete whatever is on the board into a single connected maze.
 *
 * The chosen algorithm does the carving, then `joinComponents` guarantees the result is
 * one piece: without it, a start and a goal dropped on a blank board each grow their own
 * tree and the maze comes out unsolvable. Kruskal has no carve of its own — opening every
 * cell and letting the join build the spanning tree *is* randomised Kruskal.
 */
export function completeMaze(
  grid: Grid,
  algorithm: Algorithm = "backtracker",
  rng: () => number = Math.random,
): Grid {
  if (algorithm === "backtracker") carveBacktracker(grid, rng);
  else if (algorithm === "prim") carvePrim(grid, rng);
  else for (let r = 1; r < GRID - 1; r += 2) for (let c = 1; c < GRID - 1; c += 2) grid[at(r, c)] = 1;
  joinComponents(grid, rng);
  return grid;
}

/** `count` distinct cells drawn uniformly from the odd-coordinate lattice. */
export function randomCells(count: number, rng: () => number = Math.random): Cell[] {
  const picked: Cell[] = [];
  const seen = new Set<number>();
  while (picked.length < count) {
    const r = 1 + 2 * Math.floor(rng() * CELLS);
    const c = 1 + 2 * Math.floor(rng() * CELLS);
    if (seen.has(at(r, c))) continue;
    seen.add(at(r, c));
    picked.push([r, c]);
  }
  return picked;
}

export function randomMaze(algorithm: Algorithm = "backtracker", rng: () => number = Math.random) {
  const [start, goal] = randomCells(2, rng);
  const grid = blankGrid();
  grid[at(start[0], start[1])] = 1;
  completeMaze(grid, algorithm, rng);
  return { grid, start, goal };
}

/**
 * Shortest open path from start to goal by breadth-first search. Every move costs one,
 * so BFS is already optimal and gives the yardstick the model is measured against.
 */
export function findPath(grid: Grid, start: Cell, goal: Cell): Cell[] | null {
  if (!grid[at(start[0], start[1])] || !grid[at(goal[0], goal[1])]) return null;
  const cameFrom = new Int32Array(GRID * GRID).fill(-1);
  const origin = at(start[0], start[1]);
  const target = at(goal[0], goal[1]);
  const queue = [origin];
  cameFrom[origin] = origin;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === target) {
      const path: Cell[] = [];
      for (let node = target; ; node = cameFrom[node]) {
        path.push([Math.floor(node / GRID), node % GRID]);
        if (node === origin) break;
      }
      return path;
    }
    const r = Math.floor(current / GRID);
    const c = current % GRID;
    for (const [dr, dc] of STEP1) {
      const next = at(r + dr, c + dc);
      if (isInterior(r + dr, c + dc) && grid[next] && cameFrom[next] === -1) {
        cameFrom[next] = current;
        queue.push(next);
      }
    }
  }
  return null;
}

/** Port of check.is_valid_solution: connected, on open ground, and covering both endpoints. */
export function isValidSolution(grid: Grid, path: Cell[], start: Cell, goal: Cell): boolean {
  if (!path.length) return false;
  const cells = new Set(path.map(([r, c]) => at(r, c)));
  for (const node of cells) if (!grid[node]) return false;
  if (!cells.has(at(start[0], start[1])) || !cells.has(at(goal[0], goal[1]))) return false;

  const stack = [path[0]];
  const seen = new Set([at(path[0][0], path[0][1])]);
  while (stack.length) {
    const [r, c] = stack.pop()!;
    for (const [dr, dc] of STEP1) {
      const next = at(r + dr, c + dc);
      if (cells.has(next) && !seen.has(next)) {
        seen.add(next);
        stack.push([r + dr, c + dc]);
      }
    }
  }
  return seen.size === cells.size;
}

/**
 * Pack walls and endpoints into the model's first two channels over a FULL x FULL frame.
 * Open is -1 and wall is +1 in the wall channel; the endpoint channel marks start as -1
 * and goal as +1 against a zero background.
 */
export function encodeState(grid: Grid, start: Cell, goal: Cell): Float32Array {
  const state = new Float32Array(2 * FULL * FULL);
  state.fill(1, 0, FULL * FULL); // padding outside the maze is wall
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      state[r * FULL + c] = grid[at(r, c)] ? -1 : 1;
    }
  }
  state[FULL * FULL + start[0] * FULL + start[1]] = -1;
  state[FULL * FULL + goal[0] * FULL + goal[1]] = 1;
  return state;
}

/** Threshold the model's path channel back into a list of grid cells. */
export function decodePath(prediction: Float32Array): Cell[] {
  const path: Cell[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (prediction[r * FULL + c] > 0) path.push([r, c]);
    }
  }
  return path;
}

/** Small deterministic PRNG, used so the first maze is identical on the server and the client. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
