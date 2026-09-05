"""
Export final_model.pt to ONNX for in-browser inference (web/public/model/unet.onnx).

The web playground runs the same U-Net client-side with onnxruntime-web, so the site stays
fully static. Verifies the exported graph against PyTorch before writing.
"""

import argparse
from pathlib import Path

import numpy as np
import torch

import unet

DEFAULT_OUT = Path(__file__).with_name("web") / "public" / "model" / "unet.onnx"


def main(checkpoint, out):
    model = unet.UNet()
    model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
    model.eval()

    out.parent.mkdir(parents=True, exist_ok=True)
    x = torch.randn(1, 3, 24, 24)
    t = torch.tensor([500], dtype=torch.long)
    torch.onnx.export(
        model,
        (x, t),
        str(out),
        input_names=["x", "t"],
        output_names=["eps"],
        dynamic_axes={"x": {0: "batch"}, "t": {0: "batch"}, "eps": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )

    import onnxruntime as ort

    session = ort.InferenceSession(str(out))
    x, t = torch.randn(4, 3, 24, 24), torch.randint(0, 1000, (4,))
    reference = model(x, t).detach().numpy()
    exported = session.run(None, {"x": x.numpy(), "t": t.numpy().astype(np.int64)})[0]
    drift = np.abs(reference - exported).max()
    assert drift < 1e-4, f"ONNX output drifted from PyTorch by {drift}"
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB), max drift {drift:.2e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, default=Path(__file__).with_name("final_model.pt"))
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    main(**vars(parser.parse_args()))
