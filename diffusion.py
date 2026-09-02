from matplotlib import pyplot as plt
import numpy as np
import torch
import torch.nn.functional as F
import tqdm

import maze
import unet


T = 1000
betas = torch.linspace(0.0001, 0.02, T, device="cuda")
alphas = 1.0 - betas
alpha_bar = torch.cumprod(alphas, dim=0)


def train():
    model = unet.UNet().cuda()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    rng = torch.Generator().manual_seed(0)

    data = torch.from_numpy(maze.get_samples((24, 23), 1000))

    train, dev, test = torch.utils.data.random_split(data, [0.8, 0.1, 0.1], generator=rng)
    train_loader = torch.utils.data.DataLoader(train, batch_size=16, shuffle=True)
    dev_loader = torch.utils.data.DataLoader(dev, batch_size=16, shuffle=True)
    test_loader = torch.utils.data.DataLoader(test, batch_size=16, shuffle=True)

    for epoch in range(10):
        with tqdm.tqdm(train_loader) as pbar:
            for x in pbar:
                state, x0 = x[:, :2].cuda(), x[:, 2:3].cuda()  # walls+endpoints / path

                t = torch.randint(0, T, (state.shape[0],)).cuda()
                noise = torch.randn_like(x0)
                x = alpha_bar[t].sqrt().view(-1, 1, 1, 1) * x0 + (1 - alpha_bar[t]).sqrt().view(-1, 1, 1, 1) * noise

                pred = model(torch.cat([state, x], dim=1), t)
                loss = F.mse_loss(pred, noise)
                loss.backward()
                optimizer.step()
                pbar.set_postfix(loss=loss.item())
    return model


if __name__ == "__main__":
    train()