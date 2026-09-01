"""
Validity checker for maze solutions.
"""

import numpy as np

from maze import find_path, generate_maze, random_cell


def is_valid_solution(grid, path, start, stop):
    """True if path (a collection of (row, col) positions) solves the maze"""
    path_cells = set(map(tuple, path))

    if not path_cells:
        return False

    if any(grid[cell] == 0 for cell in path_cells):
        return False

    if start not in path_cells or stop not in path_cells:
        return False

    # Flood fill from an arbitrary path cell, a valid path reaches all
    stack = [next(iter(path_cells))]
    seen = {stack[0]}
    while stack:
        r, c = stack.pop()
        for n in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if n in path_cells and n not in seen:
                seen.add(n)
                stack.append(n)
    return seen == path_cells


def _tests():
    rng = np.random.default_rng(0)
    grid_size = 21

    for trial in range(20):
        if trial % 2 == 1:
            start = random_cell(grid_size, rng)
            stop = random_cell(grid_size, rng)
            while stop == start:
                stop = random_cell(grid_size, rng)
        else:
            start = (1, 1)
            stop = (grid_size - 2, grid_size - 2)

        grid = np.zeros((grid_size, grid_size))
        grid[start] = 1
        grid[stop] = 1
        grid = generate_maze(grid, start, rng)
        path = find_path(grid, start, stop)

        # The A* ground truth must pass
        assert is_valid_solution(grid, path, start, stop), f"trial {trial}: true solution rejected"

        # An empty path must fail
        assert not is_valid_solution(grid, [], start, stop), f"trial {trial}: empty path accepted"

        # Deleting a middle cell (disconnects the path) must fail
        broken = path[: len(path) // 2] + path[len(path) // 2 + 1 :]
        assert not is_valid_solution(grid, broken, start, stop), f"trial {trial}: disconnected path accepted"

        # A path cell on top of a wall must fail
        wall = tuple(np.argwhere(grid == 0)[0])
        assert not is_valid_solution(grid, path + [wall], start, stop), f"trial {trial}: wall-crossing path accepted"

        # A path not reaching the goal must fail
        assert not is_valid_solution(grid, [c for c in path if c != stop], start, stop), f"trial {trial}: path missing goal accepted"

    print("All validity checker tests passed (20 mazes x 5 cases).")


if __name__ == "__main__":
    _tests()
