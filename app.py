from pathlib import Path

import spaces
import gradio as gr
import numpy as np
import torch

import maze
from diffusion import FULL_SIZE, GRID_SIZE, device, sample
from unet import UNet
from visualize import to_rgb


model = UNet().to(device)
model.load_state_dict(torch.load(Path(__file__).with_name("final_model.pt"), map_location=device, weights_only=True))
model.eval()
rng = np.random.default_rng()


@spaces.GPU(duration=10)
@torch.inference_mode()
def solve():
    example = maze.get_samples(1, GRID_SIZE, FULL_SIZE, rng)[0]
    state = torch.from_numpy(example[:2]).unsqueeze(0).to(device)
    prediction, _ = sample(model, state)
    path = torch.where(prediction[0] > 0, 1.0, -1.0).cpu().numpy()

    grid, path, start, stop = maze.parse_sample(np.concatenate([example[:2], path]))
    image = to_rgb(grid, path, start, stop)
    return np.repeat(np.repeat(image, 16, axis=0), 16, axis=1)


with gr.Blocks(title="Diffusion maze solver") as demo:
    gr.Markdown("# Diffusion maze solver\nPathfinding through denoising.")
    output = gr.Image(show_label=False, interactive=False, container=False)
    button = gr.Button("Solve another maze", variant="primary")

    demo.load(solve, outputs=output)
    button.click(solve, outputs=output, api_name="solve")


if __name__ == "__main__":
    demo.launch()
