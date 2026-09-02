"""
Maze generation and solving.

Grid is represented as an NxN numpy array where N is odd. Each cell is a wall (0) or open (1),
with the outer border being always wall.
"""

from collections import defaultdict
from queue import PriorityQueue

import numpy as np


# Recursive backtracker (jumps of 2 pixels)
def cell_neighbors(pos, grid_size):
    dirs = np.array([[-2, 0], [0, -2], [0, 2], [2, 0]])
    ns = np.array(pos) + dirs

    valid_mask = (ns[:, 0] > 0) & (ns[:, 0] < grid_size - 1) & (ns[:, 1] > 0) & (ns[:, 1] < grid_size - 1)
    return list(map(tuple, ns[valid_mask]))


def generate_maze(grid_size, start, rng):
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


def get_samples(count, grid_size, full_size, rng):
    """
    Get a (count, 3, full_size, full_size) shaped array of 'count' samples where the 3 channels represent one maze:
    [0: walls, 1: endpoints, 2: path]. All values in [-1, 1]. If full_size > grid_size, the maze is
    centered and the surrounding padding is wall.
    """
    off = (full_size - grid_size) // 2
    window = slice(off, off + grid_size)

    endpoints = [random_cells(grid_size, 2, rng) for _ in range(count)]
    grids = [generate_maze(grid_size, endpoints[i][0], rng) for i in range(count)]
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
