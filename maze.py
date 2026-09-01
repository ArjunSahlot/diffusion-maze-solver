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


def generate_maze(grid, start, rng):
    grid_size = grid.shape[0]
    visited = set()
    stack = []
    visited.add(start)
    stack.append(start)

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


def random_cell(grid_size, rng):
    """A random cell position (odd coordinates) within the grid."""
    return tuple(1 + 2 * rng.integers(0, (grid_size - 1) // 2, size=2))
