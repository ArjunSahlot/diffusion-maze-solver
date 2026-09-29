"""
Maze generation and solving.

Grid is represented as an NxN numpy array where N is odd. Each cell is a wall (0) or open (1),
with the outer border being always wall.
"""

from collections import defaultdict
from queue import PriorityQueue

import numpy as np


# Maze generation algs
def cell_neighbors(pos, grid_size):
    dirs = np.array([[-2, 0], [0, -2], [0, 2], [2, 0]])
    ns = np.array(pos) + dirs

    valid_mask = (ns[:, 0] > 0) & (ns[:, 0] < grid_size - 1) & (ns[:, 1] > 0) & (ns[:, 1] < grid_size - 1)
    return list(map(tuple, ns[valid_mask]))


def carve(grid, a, b):
    """Open neighboring cells a and b and the wall between them"""
    grid[a] = grid[b] = 1
    grid[(a[0] + b[0]) // 2, (a[1] + b[1]) // 2] = 1


def all_cells(grid_size):
    return [(r, c) for r in range(1, grid_size - 1, 2) for c in range(1, grid_size - 1, 2)]


def recursive_backtracker(grid_size, start, rng):
    grid = np.zeros((grid_size, grid_size), dtype=int)
    grid[start] = 1
    visited = set()
    stack = [start]
    visited.add(start)

    while stack:
        curr = stack.pop(-1)
        ns = cell_neighbors(curr, grid_size)
        unvisited = [n for n in ns if n not in visited]
        if unvisited:
            stack.append(curr)
            chosen = unvisited[rng.integers(0, len(unvisited))]
            grid[tuple(np.mean([curr, chosen], axis=0, dtype=int))] = 1
            grid[chosen] = 1
            visited.add(chosen)
            stack.append(chosen)

    return grid


def prims(grid_size, start, rng):
    """Randomized Prim's: every frontier edge gets a random priority, always open the cheapest one"""
    grid = np.zeros((grid_size, grid_size), dtype=int)
    grid[start] = 1
    queue = PriorityQueue()
    for n in cell_neighbors(start, grid_size):
        queue.put((rng.random(), start, n))
    while not queue.empty():
        _, curr, chosen = queue.get()
        if grid[chosen]:
            continue
        carve(grid, curr, chosen)
        for n in cell_neighbors(chosen, grid_size):
            if not grid[n]:
                queue.put((rng.random(), chosen, n))
    return grid


def kruskals(grid_size, start, rng):
    """Randomized Kruskal's: visit walls in random order, open one if it joins two separate regions"""
    grid = np.zeros((grid_size, grid_size), dtype=int)
    cells = all_cells(grid_size)
    parent = {cell: cell for cell in cells}

    def find(cell):
        while parent[cell] != cell:
            cell = parent[cell]
        return cell

    edges = [(a, b) for a in cells for b in cell_neighbors(a, grid_size) if a < b]
    for i in rng.permutation(len(edges)):
        a, b = edges[i]
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[root_a] = root_b
            carve(grid, a, b)
    return grid


def ellers(grid_size, start, rng):
    """Eller's: build row by row, randomly join neighbors in a row, then carry every region down at least once"""
    grid = np.zeros((grid_size, grid_size), dtype=int)
    rows = range(1, grid_size - 1, 2)
    cols = range(1, grid_size - 1, 2)
    region = list(range(len(cols)))  # region id of each cell in the current row
    next_region = len(cols)

    for r in rows:
        last_row = r == rows[-1]
        for i in range(len(cols) - 1):
            # on the last row every separate region must be joined, otherwise it's a coin flip
            if region[i] != region[i + 1] and (last_row or rng.random() < 0.5):
                carve(grid, (r, cols[i]), (r, cols[i + 1]))
                merged, kept = region[i + 1], region[i]
                region = [kept if x == merged else x for x in region]
        for i in range(len(cols)):
            grid[r, cols[i]] = 1
        if last_row:
            break

        below = [None] * len(cols)
        for x in set(region):
            members = [i for i in range(len(cols)) if region[i] == x]
            for i in rng.choice(members, size=rng.integers(1, len(members) + 1), replace=False):
                carve(grid, (r, cols[i]), (r + 2, cols[i]))
                below[i] = x
        for i in range(len(cols)):
            if below[i] is None:
                below[i] = next_region
                next_region += 1
        region = below
    return grid


def wilson(grid_size, start, rng):
    """Wilson's: loop-erased random walks until they hit the maze, every possible maze is equally likely"""
    grid = np.zeros((grid_size, grid_size), dtype=int)
    grid[start] = 1
    for cell in all_cells(grid_size):
        # random walk until hitting the maze, remembering only the last exit taken from each cell (erases loops)
        exit_to = {}
        curr = cell
        while not grid[curr]:
            ns = cell_neighbors(curr, grid_size)
            exit_to[curr] = ns[rng.integers(0, len(ns))]
            curr = exit_to[curr]

        path = [cell]
        while path[-1] in exit_to:
            path.append(exit_to[path[-1]])
        for a, b in zip(path, path[1:]):
            carve(grid, a, b)
    return grid


def generate_maze(grid_size, start, rng, alg="recursive_backtracker"):
    if alg == "recursive_backtracker":
        return recursive_backtracker(grid_size, start, rng)
    elif alg == "prims":
        return prims(grid_size, start, rng)
    elif alg == "kruskals":
        return kruskals(grid_size, start, rng)
    elif alg == "ellers":
        return ellers(grid_size, start, rng)
    elif alg == "wilson":
        return wilson(grid_size, start, rng)
    else:
        raise ValueError(f"Unknown maze generation algorithm: {alg}")


# A* pathfinding (jumps of 1 pixel)
def open_neighbors(grid, pos):
    grid_size = grid.shape[0]
    dirs = np.array([[-1, 0], [0, -1], [0, 1], [1, 0]])
    ns = np.array(pos) + dirs

    valid_mask = (ns[:, 0] > 0) & (ns[:, 0] < grid_size - 1) & (ns[:, 1] > 0) & (ns[:, 1] < grid_size - 1)
    rows, cols = zip(*ns)
    return list(map(tuple, ns[valid_mask & list(map(bool, grid[rows, cols]))]))


def find_path(grid, start, stop):
    open_set = PriorityQueue()
    came_from = {}
    g_score = defaultdict(lambda: 99999999)
    g_score[start] = 0

    h = lambda x: abs(stop[0] - x[0]) + abs(stop[1] - x[1])

    f_score = defaultdict(lambda: 99999999)
    f_score[start] = h(start)

    open_set.put((f_score[start], start))

    while not open_set.empty():
        current = open_set.get()
        currpos = current[1]
        if currpos == stop:
            final_path = [stop]
            while currpos in came_from.keys():
                currpos = came_from[currpos]
                final_path.append(currpos)
            return final_path

        for n in open_neighbors(grid, currpos):
            tentative_g_score = g_score[currpos] + 1
            if tentative_g_score < g_score[n]:
                came_from[n] = currpos
                g_score[n] = tentative_g_score
                f_score[n] = g_score[n] + h(n)
                open_set.put((f_score[n], n))

    return False


def random_cells(grid_size, count, rng):
    """Get 'count' non-overlapping random cells within the grid."""
    if count > ((grid_size - 1) // 2) ** 2:
        raise ValueError("Too many cells requested for the grid size")
    cells = []
    while len(cells) < count:
        cell = tuple(1 + 2 * rng.integers(0, (grid_size - 1) // 2, size=2))
        if cell not in cells:
            cells.append(cell)
    return cells


def get_samples(count, grid_size, full_size, rng, algs=("recursive_backtracker",)):
    """
    Get a (count, 3, full_size, full_size) shaped array of 'count' samples where the 3 channels represent one maze:
    [0: walls, 1: endpoints, 2: path]. All values in [-1, 1]. If full_size > grid_size, the maze is
    centered and the surrounding padding is wall. Each maze uses a generator picked uniformly from 'algs'.
    """
    off = (full_size - grid_size) // 2
    window = slice(off, off + grid_size)

    endpoints = [random_cells(grid_size, 2, rng) for _ in range(count)]
    grids = [generate_maze(grid_size, endpoints[i][0], rng, algs[rng.integers(0, len(algs))]) for i in range(count)]
    paths = [find_path(grids[i], endpoints[i][0], endpoints[i][1]) for i in range(count)]

    samples = np.zeros((count, 3, full_size, full_size), dtype=np.float32)
    samples[:, 0] = 1  # wall
    samples[:, 2] = -1  # no path
    for i, g, (start, stop), path in zip(range(count), grids, endpoints, paths):
        samples[i, 0, window, window] = 1 - g * 2
        samples[i, 1, start[0] + off, start[1] + off] = -1
        samples[i, 1, stop[0] + off, stop[1] + off] = 1
        pr, pc = zip(*path)
        samples[i, 2, np.array(pr) + off, np.array(pc) + off] = 1
    return samples


def parse_sample(sample):
    """Inverse of get_samples for one (3, full_size, full_size) sample: returns (grid, path, start, stop) in
    full_size coordinates, ready for check.is_valid_solution. Works on model output too once the path
    channel has been thresholded to -1/1."""
    walls, endpoints, path = sample
    grid = (walls == -1).astype(int)
    start = tuple(np.argwhere(endpoints == -1)[0])
    stop = tuple(np.argwhere(endpoints == 1)[0])
    path = list(map(tuple, np.argwhere(path == 1)))
    return grid, path, start, stop
