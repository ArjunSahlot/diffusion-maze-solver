"""Render a grid of solved mazes to samples.png for visual inspection."""

import matplotlib.pyplot as plt
import numpy as np

from maze import find_path, generate_maze, random_cell

WALL_COLOR = (0.13, 0.13, 0.16)
PATH_COLOR = (0.31, 0.56, 0.97)
START_COLOR = (0.18, 0.80, 0.44)
GOAL_COLOR = (0.91, 0.30, 0.24)


def to_rgb(grid, path, start, stop):
    img = np.ones((*grid.shape, 3))
    img[grid == 0] = WALL_COLOR
    rows, cols = zip(*path)
    img[rows, cols] = PATH_COLOR
    img[start] = START_COLOR
    img[stop] = GOAL_COLOR
    return img


def main():
    rng = np.random.default_rng()
    grid_size = 21
    fig, axes = plt.subplots(4, 4, figsize=(10, 10))

    # Top half: corner-to-corner, bottom half: random endpoints
    for i, ax in enumerate(axes.flat):
        if i < 8:
            start = (1, 1)
            stop = (grid_size - 2, grid_size - 2)
        else:
            start = random_cell(grid_size, rng)
            stop = random_cell(grid_size, rng)
            while stop == start:
                stop = random_cell(grid_size, rng)

        grid = np.zeros((grid_size, grid_size))
        grid[start] = 1
        grid[stop] = 1
        grid = generate_maze(grid, start, rng)
        path = find_path(grid, start, stop)

        ax.imshow(to_rgb(grid, path, start, stop), interpolation="nearest")
        ax.set_axis_off()

    fig.tight_layout()
    fig.savefig("samples.png", dpi=150, bbox_inches="tight")
    print("Wrote samples.png")


if __name__ == "__main__":
    main()
