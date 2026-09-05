/**
 * Runs the U-Net in a worker so a solve never blocks the editor.
 *
 * Prefers WebGPU and falls back to WebAssembly. The model is fetched once with progress
 * reporting because it is a ~21 MB download, then cached by the browser.
 */

import * as ort from "onnxruntime-web";

import { FULL } from "./maze";
import { sample } from "./diffusion";

ort.env.wasm.wasmPaths = "/ort/";
ort.env.logLevel = "error";

export type SolverRequest =
  | { type: "load" }
  | { type: "solve"; id: number; state: Float32Array; steps: number }
  | { type: "cancel" };

export type SolverEvent =
  | { type: "downloading"; received: number; total: number }
  | { type: "preparing" }
  | { type: "ready"; backend: string }
  | { type: "frame"; id: number; t: number; progress: number; x0: Float32Array }
  | { type: "done"; id: number }
  | { type: "error"; message: string };

const post = (event: SolverEvent, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(event, transfer);

let session: Promise<ort.InferenceSession> | null = null;
let cancelled = false;

async function fetchModel(): Promise<ArrayBuffer> {
  const response = await fetch("/model/unet.onnx");
  if (!response.ok) throw new Error(`could not load the model (${response.status})`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) return response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    post({ type: "downloading", received, total });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

/**
 * WebGPU compiles its shaders on the first inference, which costs several seconds. Doing that
 * once here, while the page is still being read, keeps the first real solve as fast as the rest.
 */
async function warmUp(created: ort.InferenceSession) {
  await created.run({
    x: new ort.Tensor("float32", new Float32Array(3 * FULL * FULL), [1, 3, FULL, FULL]),
    t: new ort.Tensor("int64", BigInt64Array.from([BigInt(0)]), [1]),
  });
}

function load(): Promise<ort.InferenceSession> {
  session ??= (async () => {
    const model = await fetchModel();
    post({ type: "preparing" });
    const hasWebGPU = "gpu" in navigator;
    for (const backend of hasWebGPU ? ["webgpu", "wasm"] : ["wasm"]) {
      try {
        const created = await ort.InferenceSession.create(model, { executionProviders: [backend] });
        await warmUp(created);
        post({ type: "ready", backend });
        return created;
      } catch (error) {
        if (backend === "wasm") throw error;
      }
    }
    throw new Error("no execution provider available");
  })();
  return session;
}

self.onmessage = async ({ data }: MessageEvent<SolverRequest>) => {
  if (data.type === "cancel") {
    cancelled = true;
    return;
  }

  try {
    if (data.type === "load") {
      await load();
      return;
    }

    const model = await load();
    cancelled = false;
    const runModel = async (input: Float32Array, t: number) => {
      const output = await model.run({
        x: new ort.Tensor("float32", input, [1, 3, FULL, FULL]),
        t: new ort.Tensor("int64", BigInt64Array.from([BigInt(t)]), [1]),
      });
      return output.eps.data as Float32Array;
    };

    for await (const frame of sample(data.state, data.steps, runModel)) {
      if (cancelled) return;
      post({ type: "frame", id: data.id, ...frame }, [frame.x0.buffer]);
    }
    if (!cancelled) post({ type: "done", id: data.id });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

// Keeps the isolatedModules build happy for a module worker.
export {};
