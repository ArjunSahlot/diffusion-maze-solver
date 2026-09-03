"""
Diffusion training and sampling. Run `python diffusion.py --overfit` first to verify the pipeline on a single maze.
"""

import argparse
import os

from matplotlib import pyplot as plt
import numpy as np
import torch
import torch.nn.functional as F
import tqdm

import maze
import unet
from check import is_valid_solution

device = "cuda" if torch.cuda.is_available() else "cpu"

GRID_SIZE = 23
FULL_SIZE = 24

# noise schedule
T = 1000
betas = torch.linspace(0.0001, 0.02, T, device=device)
alphas = 1.0 - betas
alpha_bar = torch.cumprod(alphas, dim=0)


def q_sample(x0, t, noise):
    """Forward process: noise the clean path x0 to timestep t in one jump"""
    return alpha_bar[t].sqrt().view(-1, 1, 1, 1) * x0 + (1 - alpha_bar[t]).sqrt().view(-1, 1, 1, 1) * noise


@torch.no_grad()
def sample_steps(model, state):
    """Yield the model's path guess after each reverse diffusion step."""
    x = torch.randn(state.shape[0], 1, *state.shape[2:], device=state.device)
    for t in reversed(range(T)):
        tt = torch.full((state.shape[0],), t, device=state.device)
        eps = model(torch.cat([state, x], dim=1), tt)
        x0_hat = (x - (1 - alpha_bar[t]).sqrt() * eps) / alpha_bar[t].sqrt()
        mean = (x - betas[t] / (1 - alpha_bar[t]).sqrt() * eps) / alphas[t].sqrt()
        x = mean + betas[t].sqrt() * torch.randn_like(x) if t > 0 else mean
        yield t, x, x0_hat


@torch.no_grad()
def sample(model, state, record_every=None):
    """
    Reverse process: denoise pure noise into a path channel, conditioned on state (walls+endpoints).
    Also returns the model's running guess of the clean path every 'record_every' steps, for visualizing.
    """
    frames = []
    for t, x, x0_hat in sample_steps(model, state):
        if record_every and t % record_every == 0:
            frames.append((t, x0_hat.clamp(-1, 1)))
    return x, frames


def validity_rate(model, samples):
    """Fraction of samples whose generated path actually solves its maze"""
    state = samples[:, :2].to(device)
    x, _ = sample(model, state)
    path = torch.where(x > 0, 1.0, -1.0)
    generated = torch.cat([state, path], dim=1).cpu().numpy()
    return np.mean([is_valid_solution(*maze.parse_sample(s)) for s in generated])


def load_samples(name, count, seed):
    """Mazes take ~5ms each to generate, so pools are generated once and cached in data/"""
    path = f"data/{name}_{count}.npy"
    if os.path.exists(path):
        return torch.from_numpy(np.load(path))
    samples = maze.get_samples(count, GRID_SIZE, FULL_SIZE, np.random.default_rng(seed))
    os.makedirs("data", exist_ok=True)
    np.save(path, samples)
    return torch.from_numpy(samples)


def train(data, steps, batch_size, lr, heldout, eval_every=1000):
    model = unet.UNet().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    data = data.to(device)

    with tqdm.trange(steps) as pbar:
        for step in pbar:
            batch = data[torch.randint(0, len(data), (batch_size,), device=device)]
            state, x0 = batch[:, :2], batch[:, 2:3]  # walls+endpoints / path

            t = torch.randint(0, T, (batch_size,), device=device)
            noise = torch.randn_like(x0)
            x_t = q_sample(x0, t, noise)

            pred = model(torch.cat([state, x_t], dim=1), t)
            loss = F.mse_loss(pred, noise)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            pbar.set_postfix(loss=f"{loss.item():.4f}")

            if (step + 1) % eval_every == 0:
                model.eval()
                pbar.write(f"step {step + 1}: validity {validity_rate(model, heldout):.1%} loss {loss.item():.4f}")
                model.train()
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--overfit", action="store_true", help="memorize a single maze to verify the pipeline")
    parser.add_argument("--steps", type=int)
    args = parser.parse_args()

    if args.overfit:
        data = torch.from_numpy(maze.get_samples(1, GRID_SIZE, FULL_SIZE, np.random.default_rng(0))).repeat(32, 1, 1, 1)
        heldout = data
        steps, batch_size, lr = args.steps or 1000, 32, 1e-3
    else:
        data = load_samples("train", 20_000, seed=0)
        heldout = load_samples("heldout", 256, seed=1)
        steps, batch_size, lr = args.steps or 20_000, 128, 2e-4

    model = train(data, steps, batch_size, lr, heldout)
    model.eval()
    torch.save(model.state_dict(), "model.pt")
    print(f"final validity: {validity_rate(model, heldout):.1%}")

    # watch the model solve one held-out maze: its running guess of the clean path, then the truth
    truth = heldout[:1].to(device)
    x, frames = sample(model, truth[:, :2], record_every=100)
    fig, axes = plt.subplots(1, len(frames) + 1, figsize=(2 * (len(frames) + 1), 2.4))
    for ax, (t, frame) in zip(axes, frames):
        ax.imshow(frame[0, 0].cpu(), cmap="gray", vmin=-1, vmax=1)
        ax.set_title(f"t={t}")
    axes[-1].imshow(truth[0, 2].cpu(), cmap="gray", vmin=-1, vmax=1)
    axes[-1].set_title("truth")
    for ax in axes:
        ax.set_axis_off()
    plt.show()
