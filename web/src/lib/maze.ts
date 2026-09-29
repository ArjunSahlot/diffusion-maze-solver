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
    note: "Long winding corridors and few junctions. The hardest style for the model, with the longest paths.",
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

const decode = (node: number): Cell => [Math.floor(node / GRID), node % GRID];

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** One corridor between two neighboring cells on the odd-coordinate lattice. */
type Edge = { a: number; b: number; mid: number };

function cellNodes(): number[] {
  const cells: number[] = [];
  for (let r = 1; r < GRID - 1; r += 2) {
    for (let c = 1; c < GRID - 1; c += 2) cells.push(at(r, c));
  }
  return cells;
}

function cellEdges(): Edge[] {
  const edges: Edge[] = [];
  for (let r = 1; r < GRID - 1; r += 2) {
    for (let c = 1; c < GRID - 1; c += 2) {
      if (c + 2 < GRID - 1) edges.push({ a: at(r, c), b: at(r, c + 2), mid: at(r, c + 1) });
      if (r + 2 < GRID - 1) edges.push({ a: at(r, c), b: at(r + 2, c), mid: at(r + 1, c) });
    }
  }
  return edges;
}

function unionFind(size: number) {
  const parent = new Int32Array(size);
  for (let i = 0; i < size; i++) parent[i] = i;
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
  return { find, union };
}

/** A perfect maze is 121 open cells plus 120 corridors. More open than that is an unfinished room. */
const TREE_OPEN = CELLS * CELLS + (CELLS * CELLS - 1);

function openInterior(grid: Grid): number {
  let open = 0;
  for (let r = 1; r < GRID - 1; r++) {
    for (let c = 1; c < GRID - 1; c++) if (grid[at(r, c)]) open++;
  }
  return open;
}

function neighborsOf(node: number): Edge[] {
  const [r, c] = decode(node);
  return cellNeighbors(r, c).map(([nr, nc]) => ({ a: node, b: at(nr, nc), mid: at((r + nr) / 2, (c + nc) / 2) }));
}

/**
 * Spanning tree of the 11×11 cells. `forced` edges are already part of the drawing;
 * `blocked` edges are walls the user placed and are only carved if the maze would
 * otherwise stay in pieces.
 */
function spanningTree(algorithm: Algorithm, forced: Edge[], blocked: Set<number>, rng: () => number): Edge[] {
  if (algorithm === "kruskal") return growKruskal(forced, blocked, rng);
  if (algorithm === "prim") return growPrim(forced, blocked, rng);
  return growBacktracker(forced, blocked, rng);
}

function growKruskal(forced: Edge[], blocked: Set<number>, rng: () => number): Edge[] {
  const { union } = unionFind(GRID * GRID);
  const tree: Edge[] = [];
  for (const edge of forced) if (union(edge.a, edge.b)) tree.push(edge);
  const preferred = shuffle(
    cellEdges().filter((edge) => !blocked.has(edge.mid)),
    rng,
  );
  const fallback = shuffle(
    cellEdges().filter((edge) => blocked.has(edge.mid)),
    rng,
  );
  for (const edge of preferred) if (union(edge.a, edge.b)) tree.push(edge);
  for (const edge of fallback) if (union(edge.a, edge.b)) tree.push(edge);
  return tree;
}

function growBacktracker(forced: Edge[], blocked: Set<number>, rng: () => number): Edge[] {
  const { find, union } = unionFind(GRID * GRID);
  const tree: Edge[] = [];
  for (const edge of forced) if (union(edge.a, edge.b)) tree.push(edge);

  const cells = cellNodes();
  const visited = new Set<number>();
  const stack: number[] = [];

  // A forced corridor is a whole component: stepping onto one cell opens the rest of it.
  const absorb = (node: number) => {
    const root = find(node);
    const members = cells.filter((cell) => find(cell) === root && !visited.has(cell));
    for (const member of shuffle(members, rng)) {
      visited.add(member);
      stack.push(member);
    }
  };

  absorb(cells[Math.floor(rng() * cells.length)]);

  while (visited.size < cells.length) {
    while (stack.length) {
      const current = stack[stack.length - 1];
      const options = neighborsOf(current).filter((edge) => !visited.has(edge.b));
      const preferred = options.filter((edge) => !blocked.has(edge.mid));
      if (!preferred.length) {
        stack.pop();
        continue;
      }
      const pick = preferred[Math.floor(rng() * preferred.length)];
      union(current, pick.b);
      tree.push(pick);
      absorb(pick.b);
    }
    if (visited.size < cells.length) {
      let pick: Edge | undefined;
      let fallback: Edge | undefined;
      for (const node of visited) {
        for (const edge of neighborsOf(node)) {
          if (visited.has(edge.b)) continue;
          if (!blocked.has(edge.mid)) {
            pick = edge;
            break;
          }
          fallback ??= edge;
        }
        if (pick) break;
      }
      const edge = pick ?? fallback;
      if (!edge) {
        absorb(cells.find((cell) => !visited.has(cell))!);
        continue;
      }
      union(edge.a, edge.b);
      tree.push(edge);
      absorb(edge.b);
    }
  }
  return tree;
}

function growPrim(forced: Edge[], blocked: Set<number>, rng: () => number): Edge[] {
  const { find, union } = unionFind(GRID * GRID);
  const tree: Edge[] = [];
  for (const edge of forced) if (union(edge.a, edge.b)) tree.push(edge);

  const cells = cellNodes();
  const visited = new Set<number>();
  const absorb = (node: number) => {
    const root = find(node);
    for (const cell of cells) if (find(cell) === root) visited.add(cell);
  };
  absorb(cells[Math.floor(rng() * cells.length)]);

  const frontier: Edge[] = [];
  const extend = (node: number) => {
    for (const edge of neighborsOf(node)) if (!visited.has(edge.b)) frontier.push(edge);
  };
  for (const node of visited) extend(node);

  while (visited.size < cells.length) {
    let live = 0;
    for (const edge of frontier) if (!visited.has(edge.b)) frontier[live++] = edge;
    frontier.length = live;
    if (!frontier.length) {
      let pick: Edge | undefined;
      let fallback: Edge | undefined;
      for (const node of visited) {
        for (const edge of neighborsOf(node)) {
          if (visited.has(edge.b)) continue;
          if (!blocked.has(edge.mid)) {
            pick = edge;
            break;
          }
          fallback ??= edge;
        }
        if (pick) break;
      }
      const edge = pick ?? fallback;
      if (!edge) break;
      union(edge.a, edge.b);
      tree.push(edge);
      absorb(edge.b);
      for (const cell of cells) if (visited.has(cell) && find(cell) === find(edge.b)) extend(cell);
      continue;
    }
    const preferred = frontier.filter((edge) => !blocked.has(edge.mid));
    const pool = preferred.length ? preferred : frontier;
    const pick = pool[Math.floor(rng() * pool.length)];
    frontier[frontier.indexOf(pick)] = frontier[frontier.length - 1];
    frontier.pop();
    if (visited.has(pick.b)) continue;
    union(pick.a, pick.b);
    tree.push(pick);
    const before = visited.size;
    absorb(pick.b);
    if (visited.size > before) {
      for (const cell of cells) if (visited.has(cell) && find(cell) === find(pick.b)) extend(cell);
    }
  }
  return tree;
}

function paintTree(grid: Grid, tree: Edge[]): void {
  for (let r = 1; r < GRID - 1; r++) {
    for (let c = 1; c < GRID - 1; c++) grid[at(r, c)] = r % 2 === 1 && c % 2 === 1 ? 1 : 0;
  }
  for (const edge of tree) grid[edge.mid] = 1;
}

/** Endpoints can sit off the cell lattice after a drag; keep them on open ground. */
function preserveEndpoints(grid: Grid, keep: Cell[]): void {
  for (const [r, c] of keep) {
    if (!isInterior(r, c)) continue;
    grid[at(r, c)] = 1;
    if (isCell(r, c)) continue;
    const [sr, sc] = snapToCell(r, c);
    grid[at(sr, sc)] = 1;
  }
}

function userLocked(drawn: Uint8Array | undefined, grid: Grid) {
  const blocked = new Set<number>();
  const forbidden = new Set<number>();
  if (!drawn) return { blocked, forbidden, any: false };
  let any = false;
  for (let i = 0; i < drawn.length; i++) {
    if (!drawn[i]) continue;
    any = true;
    if (!grid[i]) {
      blocked.add(i);
      if (isCell(Math.floor(i / GRID), i % GRID)) forbidden.add(i);
    }
  }
  return { blocked, forbidden, any };
}

function restoreDrawn(grid: Grid, snapshot: Grid, drawn: Uint8Array | undefined) {
  if (!drawn) return;
  for (let i = 0; i < drawn.length; i++) if (drawn[i]) grid[i] = snapshot[i];
}

/** Grow into still-walled cells without closing anything already open. */
function carveInPlace(
  grid: Grid,
  algorithm: Algorithm,
  rng: () => number,
  blocked: Set<number>,
  forbidden: Set<number>,
): void {
  const cells = cellNodes().filter((cell) => !forbidden.has(cell));
  if (!cells.length) return;

  if (algorithm === "kruskal") {
    for (const cell of cells) grid[cell] = 1;
    const { union } = unionFind(GRID * GRID);
    for (const edge of cellEdges()) {
      if (forbidden.has(edge.a) || forbidden.has(edge.b) || !grid[edge.mid]) continue;
      union(edge.a, edge.b);
    }
    const usable = (edge: Edge) => !forbidden.has(edge.a) && !forbidden.has(edge.b);
    for (const edge of shuffle(
      cellEdges().filter((edge) => usable(edge) && !blocked.has(edge.mid)),
      rng,
    )) {
      if (union(edge.a, edge.b)) grid[edge.mid] = 1;
    }
    for (const edge of shuffle(
      cellEdges().filter((edge) => usable(edge) && blocked.has(edge.mid)),
      rng,
    )) {
      if (union(edge.a, edge.b)) grid[edge.mid] = 1;
    }
    return;
  }

  const visited = new Set<number>();
  for (const cell of cells) if (grid[cell]) visited.add(cell);
  if (!visited.size) {
    const start = cells[Math.floor(rng() * cells.length)];
    grid[start] = 1;
    visited.add(start);
  }

  const unused = (edge: Edge) => !visited.has(edge.b) && !forbidden.has(edge.b);

  if (algorithm === "prim") {
    const frontier: Edge[] = [];
    const extend = (node: number) => {
      for (const edge of neighborsOf(node)) if (unused(edge)) frontier.push(edge);
    };
    for (const node of visited) extend(node);
    while (visited.size < cells.length && frontier.length) {
      const prefer = frontier.filter((edge) => unused(edge) && !blocked.has(edge.mid));
      const live = prefer.length ? prefer : frontier.filter(unused);
      if (!live.length) break;
      const pick = live[Math.floor(rng() * live.length)];
      frontier[frontier.indexOf(pick)] = frontier[frontier.length - 1];
      frontier.pop();
      if (visited.has(pick.b) || forbidden.has(pick.b)) continue;
      grid[pick.mid] = 1;
      grid[pick.b] = 1;
      visited.add(pick.b);
      extend(pick.b);
    }
    return;
  }

  const stack = shuffle([...visited], rng);
  while (visited.size < cells.length) {
    while (stack.length) {
      const current = stack[stack.length - 1];
      const options = neighborsOf(current).filter((edge) => unused(edge) && !blocked.has(edge.mid));
      if (!options.length) {
        stack.pop();
        continue;
      }
      const pick = options[Math.floor(rng() * options.length)];
      grid[pick.mid] = 1;
      grid[pick.b] = 1;
      visited.add(pick.b);
      stack.push(pick.b);
    }
    const next = cells.find((cell) => !visited.has(cell));
    if (next === undefined) break;
    grid[next] = 1;
    visited.add(next);
    stack.push(next);
  }
}

/**
 * Knock down the fewest remaining walls so open pixels are one piece. User-drawn
 * walls are tried last, so a finishing fill does not punch through the sketch.
 */
function joinInPlace(grid: Grid, rng: () => number, blocked: Set<number>): void {
  const { find, union } = unionFind(GRID * GRID);
  for (let r = 1; r < GRID - 1; r++) {
    for (let c = 1; c < GRID - 1; c++) {
      if (!grid[at(r, c)]) continue;
      if (r + 1 < GRID - 1 && grid[at(r + 1, c)]) union(at(r, c), at(r + 1, c));
      if (c + 1 < GRID - 1 && grid[at(r, c + 1)]) union(at(r, c), at(r, c + 1));
    }
  }

  const segments = cellEdges();
  const openMid = (edge: Edge) => {
    if (find(edge.a) === find(edge.b)) return;
    if (!grid[edge.a] || !grid[edge.b]) return;
    grid[edge.mid] = 1;
    union(edge.a, edge.b);
    union(edge.mid, edge.a);
  };
  for (const edge of shuffle(
    segments.filter((edge) => !blocked.has(edge.mid)),
    rng,
  )) {
    openMid(edge);
  }
  for (const edge of shuffle(
    segments.filter((edge) => blocked.has(edge.mid)),
    rng,
  )) {
    openMid(edge);
  }
}

/**
 * Finish the board into a connected maze without throwing away the drawing.
 *
 * An empty open room (Clear, then Fill) still generates a maze. Once the human has
 * painted, those pixels stay put: the algorithm only grows into remaining walls and
 * joins whatever is disconnected. That is a finishing touch, not a new maze.
 */
export function completeMaze(
  grid: Grid,
  algorithm: Algorithm = "backtracker",
  rng: () => number = Math.random,
  keep: Cell[] = [],
  drawn?: Uint8Array,
): Grid {
  const { blocked, forbidden, any: drew } = userLocked(drawn, grid);
  const snapshot = drawn ? Uint8Array.from(grid) : null;

  if (!drew && openInterior(grid) > TREE_OPEN) {
    paintTree(grid, spanningTree(algorithm, [], new Set(), rng));
    preserveEndpoints(grid, keep);
    return grid;
  }

  carveInPlace(grid, algorithm, rng, blocked, forbidden);
  joinInPlace(grid, rng, blocked);
  if (snapshot && drawn) restoreDrawn(grid, snapshot, drawn);
  preserveEndpoints(grid, keep);

  const [start, goal] = keep;
  if (start && goal && !findPath(grid, start, goal)) {
    joinInPlace(grid, rng, blocked);
    if (snapshot && drawn) restoreDrawn(grid, snapshot, drawn);
    preserveEndpoints(grid, keep);
    if (!findPath(grid, start, goal)) {
      joinInPlace(grid, rng, new Set());
      preserveEndpoints(grid, keep);
    }
  }
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
