from pathlib import Path

import spaces
import gradio as gr
import numpy as np
import torch

import maze
from diffusion import FULL_SIZE, GRID_SIZE, T, device, sample_steps
from unet import UNet
from visualize import GOAL_COLOR, PATH_COLOR, START_COLOR, WALL_COLOR, to_rgb


model = UNet().to(device)
model.load_state_dict(torch.load(Path(__file__).with_name("final_model.pt"), map_location=device, weights_only=True))
model.eval()
rng = np.random.default_rng()


def draw(example, prediction=None):
    grid, _, start, stop = maze.parse_sample(example)
    offset = (FULL_SIZE - GRID_SIZE) // 2
    window = slice(offset, offset + GRID_SIZE)
    grid = grid[window, window]
    start = (start[0] - offset, start[1] - offset)
    stop = (stop[0] - offset, stop[1] - offset)
    image = to_rgb(grid, [], start, stop)

    if prediction is not None:
        prediction = prediction[window, window]
        strength = ((np.clip(prediction, -1, 1) + 1) / 2)[..., None]
        image = image * (1 - strength) + np.array(PATH_COLOR) * strength
        image[start] = START_COLOR
        image[stop] = GOAL_COLOR

    padded = np.full((GRID_SIZE + 2, GRID_SIZE + 2, 3), WALL_COLOR)
    padded[1:-1, 1:-1] = image
    image = padded
    return np.repeat(np.repeat(image, 16, axis=0), 16, axis=1)


def new_maze():
    example = maze.get_samples(1, GRID_SIZE, FULL_SIZE, rng)[0]
    return example, draw(example), "Unsolved"


@spaces.GPU(duration=10)
@torch.inference_mode()
def solve(example):
    if example is None:
        example = maze.get_samples(1, GRID_SIZE, FULL_SIZE, rng)[0]

    state = torch.from_numpy(example[:2]).unsqueeze(0).to(device)
    for t, path, prediction in sample_steps(model, state):
        if t == T - 1 or t % 25 == 0:
            if t == 0:
                prediction = torch.where(path[0, 0] > 0, 1.0, -1.0)
            else:
                prediction = prediction[0, 0]
            yield draw(example, prediction.cpu().numpy()), "Solved" if t == 0 else f"t = {t}"


with gr.Blocks(title="Diffusion maze solver") as demo:
    gr.Markdown("# Diffusion maze solver\nPathfinding through denoising.")
    example = gr.State()
    output = gr.Image(show_label=False, interactive=False, container=False)
    status = gr.Markdown("Unsolved")

    with gr.Row():
        new_button = gr.Button("New maze")
        solve_button = gr.Button("Solve maze", variant="primary")

    demo.load(new_maze, outputs=[example, output, status], show_progress="hidden")
    solve_event = solve_button.click(solve, inputs=example, outputs=[output, status], api_name="solve")
    new_button.click(
        new_maze,
        outputs=[example, output, status],
        api_name="new_maze",
        show_progress="hidden",
        cancels=[solve_event],
    )


if __name__ == "__main__":
    demo.launch()
