# Playground

The web playground for [diffusion-maze-solver](../README.md): draw a maze, hand it to the model,
and watch the path come out of the noise.

The site is static. The U-Net runs client-side through onnxruntime-web (WebGPU, falling back to
WebAssembly), so there is no inference backend to deploy and nothing you draw leaves the browser.

## Running it

```bash
npm install
npm run dev
```

`npm run dev` and `npm run build` first mirror the onnxruntime WebAssembly binaries from
`node_modules` into `public/ort/`, which is why that directory is not checked in.

## The model

`public/model/unet.onnx` is exported from `final_model.pt` by the script one level up:

```bash
python export_onnx.py
```

The export is verified against PyTorch before it is written. Sampling uses DDIM at eta = 1 over a
strided subset of the 1000 trained timesteps: 32 steps reproduce the full sampler's solve rate at
a thirtieth of the compute, which is what makes running this in a tab reasonable.

## Deploying

Vercel autodetects the Next.js app; point the project's root directory at `web/`.
