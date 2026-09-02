from matplotlib import pyplot as plt
import numpy as np
import torch

from maze import generate_maze, find_path, random_cells


def path_image(size):
    rng = np.random.default_rng(0)
    start, stop = random_cells(size, 2, rng)

    grid = generate_maze(size, start, rng)
    path = find_path(grid, start, stop)

    path_img = np.zeros(grid.shape, dtype=np.float32)
    rows, cols = zip(*path)
    path_img[rows, cols] = 1.0

    return torch.from_numpy(path_img) * 2 - 1


def main():
    x0 = path_image(23).cuda()

    # diffusion forward pass
    T = 1000
    betas = torch.linspace(0.0001, 0.02, T, device="cuda")
    alphas = 1.0 - betas
    alpha_cumprod = torch.cumprod(alphas, dim=0)
    
    noise = torch.randn_like(x0)
    plt.figure(figsize=(10, 10))
    i = 0
    for t in [0, 10, 25, 50, 100, 250, 500, 750, 999]:
        x = alpha_cumprod[t].sqrt() * x0 + (1 - alpha_cumprod[t]).sqrt() * noise
        plt.subplot(3, 3, i + 1)
        plt.imshow(x.cpu().numpy())
        plt.title(f"t = {t}")
        i += 1
    plt.show()

if __name__ == "__main__":
    main()