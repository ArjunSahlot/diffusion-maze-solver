"""
Finetune a trained model on specific maze generators,
e.g. `python finetune.py --model general.pt --maze_alg recursive_backtracker --count 20000`
"""

import argparse

import torch

import unet
from diffusion import EVAL_ALGS, device, load_samples, train, validity_report

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, required=True)
    parser.add_argument("--maze_alg", type=str, nargs="+", required=True, help="one or more generators to finetune on")
    parser.add_argument("--count", type=int, required=True)
    parser.add_argument("--steps", type=int, default=5000)
    parser.add_argument("--batch_size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=5e-5, help="lower than training so the model isn't knocked too far")
    parser.add_argument("--out", type=str, default="finetuned.pt")
    args = parser.parse_args()

    model = unet.UNet().to(device)
    model.load_state_dict(torch.load(args.model, map_location=device, weights_only=True))
    data = load_samples("finetune", args.count, seed=0, algs=args.maze_alg)
    heldout = {alg: load_samples("heldout", 256, seed=1, algs=[alg]) for alg in EVAL_ALGS}

    model = train(data, args.steps, args.batch_size, args.lr, heldout, eval_every=args.steps + 1, model=model)
    model.eval()
    torch.save(model.state_dict(), args.out)
    print(f"final validity: {validity_report(model, heldout)}")
