/**
 * The reverse diffusion process, ported from diffusion.py.
 *
 * Training used a 1000-step linear beta schedule. Sampling here walks a strided subset of
 * those timesteps with the DDIM update at eta = 1, which is the same ancestral step the
 * original sampler takes but over far fewer model evaluations: 32 steps reproduce the
 * 1000-step solve rate (~94% on held-out mazes) at ~30x less compute, which is what makes
 * running the model in a browser tab practical.
 */

import { FULL } from "./maze";

export const T = 1000;
export const PIXELS = FULL * FULL;

/** Cumulative product of alphas for the linear beta schedule used in training. */
export const alphaBar = (() => {
  const bars = new Float64Array(T);
  let running = 1;
  for (let t = 0; t < T; t++) {
    running *= 1 - (0.0001 + ((0.02 - 0.0001) * t) / (T - 1));
    bars[t] = running;
  }
  return bars;
})();

/** Evenly spaced timesteps from T-1 down to 0, matching np.linspace(T-1, 0, steps).round(). */
export function schedule(steps: number): number[] {
  if (steps <= 1) return [0];
  return Array.from({ length: steps }, (_, i) => Math.round((T - 1) * (1 - i / (steps - 1))));
}

function randn(out: Float32Array): Float32Array {
  for (let i = 0; i < out.length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - Math.random()));
    const angle = 2 * Math.PI * Math.random();
    out[i] = radius * Math.cos(angle);
    if (i + 1 < out.length) out[i + 1] = radius * Math.sin(angle);
  }
  return out;
}

export type RunModel = (input: Float32Array, t: number) => Promise<Float32Array>;

export interface Frame {
  /** Timestep this frame was produced at, counting down to 0. */
  t: number;
  /** The model's running estimate of the clean path, clamped to [-1, 1]. */
  x0: Float32Array;
  /** How far through the schedule we are, in [0, 1]. */
  progress: number;
}

/**
 * Denoise a path channel conditioned on `state` (the packed walls and endpoints), yielding
 * the running estimate of the clean path after every step so callers can animate the solve.
 */
export async function* sample(
  state: Float32Array,
  steps: number,
  runModel: RunModel,
  eta = 1,
): AsyncGenerator<Frame> {
  const timesteps = schedule(steps);
  const input = new Float32Array(3 * PIXELS);
  input.set(state, 0);
  const x = randn(new Float32Array(PIXELS));
  const noise = new Float32Array(PIXELS);

  for (let i = 0; i < timesteps.length; i++) {
    const t = timesteps[i];
    input.set(x, 2 * PIXELS);
    const eps = await runModel(input, t);

    const barT = alphaBar[t];
    const barPrev = i + 1 < timesteps.length ? alphaBar[timesteps[i + 1]] : 1;
    const sigma =
      i + 1 < timesteps.length
        ? eta * Math.sqrt((1 - barPrev) / (1 - barT)) * Math.sqrt(1 - barT / barPrev)
        : 0;
    const direction = Math.sqrt(Math.max(0, 1 - barPrev - sigma * sigma));
    if (sigma > 0) randn(noise);

    const x0 = new Float32Array(PIXELS);
    for (let p = 0; p < PIXELS; p++) {
      const clean = Math.min(1, Math.max(-1, (x[p] - Math.sqrt(1 - barT) * eps[p]) / Math.sqrt(barT)));
      x0[p] = clean;
      x[p] = Math.sqrt(barPrev) * clean + direction * eps[p] + sigma * noise[p];
    }
    yield { t, x0, progress: (i + 1) / timesteps.length };
  }
}
