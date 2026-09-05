/**
 * onnxruntime-web loads its WebAssembly binaries at runtime rather than through the bundler,
 * so they have to be served as static files. Mirrors them into public/ort/.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "onnxruntime-web", "dist");
const to = join(root, "public", "ort");

await mkdir(to, { recursive: true });
const wanted = (name) => /^ort-wasm.*\.(wasm|mjs)$/.test(name);
const files = (await readdir(from)).filter(wanted);
await Promise.all(files.map((name) => cp(join(from, name), join(to, name))));
console.log(`copied ${files.length} onnxruntime files to public/ort/`);
