"""Local backend for the disposable Denoise Studio.

Run from the repository root with:
    uv run python gif_studio/server.py
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from collections import OrderedDict
from pathlib import Path
from typing import Callable, Literal

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageColor, ImageDraw, ImageFont
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent.parent
STUDIO_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = STUDIO_ROOT / "static"
CACHE_ROOT = STUDIO_ROOT / ".cache" / "runs"
EXPORT_ROOT = STUDIO_ROOT / "exports"
for path in (CACHE_ROOT, EXPORT_ROOT):
    path.mkdir(parents=True, exist_ok=True)

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import maze  # noqa: E402
from check import is_valid_solution  # noqa: E402
from diffusion import FULL_SIZE, GRID_SIZE, T, device, sample_steps  # noqa: E402
from unet import UNet  # noqa: E402


OFFSET = (FULL_SIZE - GRID_SIZE) // 2
WINDOW = slice(OFFSET, OFFSET + GRID_SIZE)
METRIC_KEYS = ("pixel", "rms", "path", "flips")
FONT_ROOT = Path("/usr/share/fonts/truetype/dejavu")
FONT_FILES = {
    ("sans", "regular"): "DejaVuSans.ttf",
    ("sans", "bold"): "DejaVuSans-Bold.ttf",
    ("mono", "regular"): "DejaVuSansMono.ttf",
    ("mono", "bold"): "DejaVuSansMono-Bold.ttf",
    ("serif", "regular"): "DejaVuSerif.ttf",
    ("serif", "bold"): "DejaVuSerif-Bold.ttf",
}

app = FastAPI(title="Denoise Studio", version="1.1.0")
MODEL: UNet | None = None
MODEL_LOCK = threading.RLock()
POOL_LOCK = threading.Lock()
POOLS: dict[int, list[np.ndarray]] = {}
# Every run holds 1000x23x23 frames, so a full-pool scan would pin hundreds of
# megabytes if we kept them all. Everything is on disk anyway.
RUN_CACHE_SIZE = 24
RUNS: OrderedDict[str, dict] = OrderedDict()
SCANS: dict[str, dict] = {}


class MazeRequest(BaseModel):
    seed: int = Field(482917, ge=0, le=2_147_483_647)
    count: int = Field(96, ge=12, le=500)
    diffusion_seed: int = Field(7, ge=0, le=2_147_483_647)


class RunRequest(BaseModel):
    maze_seed: int
    maze_index: int = Field(ge=0)
    diffusion_seed: int = Field(7, ge=0, le=2_147_483_647)
    force: bool = False


class ScanRequest(BaseModel):
    maze_seed: int
    count: int = Field(96, ge=1, le=500)
    diffusion_seed: int = Field(7, ge=0, le=2_147_483_647)
    batch_size: int = Field(32, ge=1, le=128)
    force: bool = False


class TextStyle(BaseModel):
    enabled: bool = True
    template: str = "t = {t}"
    solved_template: str = "SOLVED"
    failed_template: str = "FAILED"
    family: Literal["sans", "mono", "serif"] = "mono"
    size: int = Field(28, ge=8, le=180)
    weight: Literal["regular", "bold"] = "bold"
    color: str = "#ffffff"
    position: str = "top-left"
    offset_x: int = Field(0, ge=-2000, le=2000)
    offset_y: int = Field(0, ge=-2000, le=2000)
    padding: int = Field(10, ge=0, le=80)
    background: str = "#090a0c"
    background_opacity: float = Field(0.0, ge=0, le=1)
    radius: int = Field(6, ge=0, le=50)
    outline: int = Field(0, ge=0, le=12)
    shadow: bool = True
    margin: int = Field(12, ge=0, le=400)
    opacity: float = Field(1.0, ge=0, le=1)
    fade_in_frames: int = Field(0, ge=0, le=240)
    fade_out_frames: int = Field(0, ge=0, le=240)


class RenderStyle(BaseModel):
    resolution: int = Field(512, ge=128, le=2048)
    open_color: str = "#ffffff"
    wall_color: str = "#212128"
    path_color: str = "#4f8ff7"
    start_color: str = "#2ecc70"
    goal_color: str = "#e84d3d"
    border_cells: int = Field(1, ge=0, le=4)
    background: str = "#0d0f11"
    pad_top: int = Field(0, ge=0, le=800)
    pad_right: int = Field(0, ge=0, le=800)
    pad_bottom: int = Field(0, ge=0, le=800)
    pad_left: int = Field(0, ge=0, le=800)
    mask_prediction: bool = False
    gamma: float = Field(1.0, ge=0.2, le=4.0)
    grid_gap: int = Field(6, ge=0, le=80)
    text: TextStyle = TextStyle()


class ExportRequest(BaseModel):
    run_id: str = ""
    run_ids: list[str] = Field(default_factory=list, max_length=9)
    schedule: list[int] = Field(min_length=2, max_length=1200)
    fps: float = Field(20, gt=0, le=120)
    start_hold_ms: int = Field(250, ge=0, le=60_000)
    end_hold_ms: int = Field(1000, ge=0, le=60_000)
    format: Literal["gif", "mp4", "webm", "apng", "png-zip"] = "gif"
    loop: bool = True
    quality: int = Field(90, ge=1, le=100)
    colors: int = Field(128, ge=8, le=256)
    dither: bool = False
    render: RenderStyle = RenderStyle()


class FrameRequest(BaseModel):
    run_id: str = ""
    run_ids: list[str] = Field(default_factory=list, max_length=9)
    timestep: int = Field(ge=0, le=T - 1)
    index: int = Field(0, ge=0)
    count: int = Field(2, ge=2)
    fps: float = Field(20, gt=0, le=120)
    format: Literal["gif", "mp4", "webm", "apng", "png-zip"] = "gif"
    colors: int = Field(128, ge=8, le=256)
    dither: bool = False
    render: RenderStyle = RenderStyle()


def _model() -> UNet:
    global MODEL
    if MODEL is None:
        with MODEL_LOCK:
            if MODEL is None:
                model = UNet().to(device)
                model.load_state_dict(
                    torch.load(ROOT / "final_model.pt", map_location=device, weights_only=True)
                )
                model.eval()
                MODEL = model
    return MODEL


def _pool(seed: int, count: int) -> list[np.ndarray]:
    with POOL_LOCK:
        result = POOLS.setdefault(seed, [])
        # Generate each gallery item from its own seed so maze #37 is identical
        # whether the current pool contains 48 or 400 candidates.
        for index in range(len(result), count):
            rng = np.random.default_rng(np.random.SeedSequence([seed, index]))
            result.append(maze.get_samples(1, GRID_SIZE, FULL_SIZE, rng)[0])
        return result[:count]


def _run_id(seed: int, index: int, diffusion_seed: int) -> str:
    return f"s{seed}-m{index}-d{diffusion_seed}"


def _run_paths(run_id: str) -> tuple[Path, Path]:
    return CACHE_ROOT / f"{run_id}.npz", CACHE_ROOT / f"{run_id}.json"


def _cached_runs(seed: int, diffusion_seed: int) -> dict[int, list[dict]]:
    """Small summaries of the cached runs for this seed pair, keyed by maze index."""
    result: dict[int, list[dict]] = {}
    for meta_path in sorted(CACHE_ROOT.glob(f"s{seed}-m*-d{diffusion_seed}.json")):
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if not _run_paths(meta.get("id", ""))[0].exists():
            continue
        result.setdefault(int(meta["mazeIndex"]), []).append(meta)
    return result


def _maze_summary(sample: np.ndarray, index: int, seed: int, runs: list[dict]) -> dict:
    grid, path, start, stop = maze.parse_sample(sample)
    cropped = grid[WINDOW, WINDOW]
    local_start = [int(start[0] - OFFSET), int(start[1] - OFFSET)]
    local_stop = [int(stop[0] - OFFSET), int(stop[1] - OFFSET)]
    local_path = [[int(r - OFFSET), int(c - OFFSET)] for r, c in path]
    ordered = maze.find_path(cropped, tuple(local_start), tuple(local_stop)) or []
    turns = 0
    if len(ordered) > 2:
        directions = [
            (ordered[i + 1][0] - ordered[i][0], ordered[i + 1][1] - ordered[i][1])
            for i in range(len(ordered) - 1)
        ]
        turns = sum(a != b for a, b in zip(directions, directions[1:]))
    span = abs(local_start[0] - local_stop[0]) + abs(local_start[1] - local_stop[1])
    return {
        "id": f"{seed}:{index}",
        "index": index,
        "seed": seed,
        "grid": ["".join("1" if cell else "0" for cell in row) for row in cropped],
        "path": local_path,
        "start": local_start,
        "stop": local_stop,
        "pathLength": len(ordered),
        "turns": turns,
        "span": span,
        "cachedRuns": len(runs),
        "valid": any(bool(item.get("valid")) for item in runs) if runs else None,
        "settleT": min((int(item.get("settleT", 0)) for item in runs), default=None),
        "activity": round(max((float(item.get("activity", 0)) for item in runs), default=0.0), 5),
    }


def _metrics(frames: np.ndarray) -> dict[str, np.ndarray]:
    """Per-step change signals. Index i is the change between t=i+1 and t=i."""
    values = frames.astype(np.float32) / 255.0
    delta = values[1:] - values[:-1]
    solid = values >= 0.5
    return {
        "pixel": np.mean(np.abs(delta), axis=(1, 2)),
        "rms": np.sqrt(np.mean(delta * delta, axis=(1, 2))),
        "path": np.mean(np.maximum(delta, 0), axis=(1, 2)),
        "flips": np.mean(solid[1:] != solid[:-1], axis=(1, 2)),
    }


def _store_run(seed: int, index: int, diffusion_seed: int, sample: np.ndarray, frames: np.ndarray, elapsed: float) -> dict:
    final = np.full((FULL_SIZE, FULL_SIZE), -1, dtype=np.float32)
    final[WINDOW, WINDOW] = np.where(frames[0] >= 128, 1.0, -1.0)
    generated = np.concatenate([sample[:2], final[None]], axis=0)
    valid = bool(is_valid_solution(*maze.parse_sample(generated)))
    metrics = _metrics(frames)
    moving = np.flatnonzero(metrics["flips"] > 0)
    run_id = _run_id(seed, index, diffusion_seed)
    meta = {
        "id": run_id,
        "mazeSeed": seed,
        "mazeIndex": index,
        "diffusionSeed": diffusion_seed,
        "valid": valid,
        # The last timestep at which the thresholded path still changed: low values
        # mean the model keeps rearranging the path until the very end of the run.
        "settleT": int(moving.min()) if moving.size else T - 1,
        "activity": round(float(metrics["flips"].sum()), 5),
        "elapsedSeconds": round(elapsed, 3),
        "shape": [T, GRID_SIZE, GRID_SIZE],
        "device": device,
    }
    data_path, meta_path = _run_paths(run_id)
    np.savez_compressed(
        data_path, frames=frames, sample=sample,
        **{f"metric_{key}": value.astype(np.float32) for key, value in metrics.items()},
    )
    meta_path.write_text(json.dumps(meta))
    _remember(run_id, {**meta, "frames": frames, "sample": sample,
                       "metrics": {key: value.round(7).tolist() for key, value in metrics.items()}})
    return meta


def _remember(run_id: str, run: dict) -> dict:
    RUNS[run_id] = run
    RUNS.move_to_end(run_id)
    while len(RUNS) > RUN_CACHE_SIZE:
        RUNS.popitem(last=False)
    return run


def _load_run(run_id: str) -> dict:
    if run_id in RUNS:
        RUNS.move_to_end(run_id)
        return RUNS[run_id]
    data_path, meta_path = _run_paths(run_id)
    if not data_path.exists() or not meta_path.exists():
        raise HTTPException(404, "Run not found. Analyze the maze first.")
    try:
        meta = json.loads(meta_path.read_text())
        archive = np.load(data_path)
        frames = archive["frames"]
        if f"metric_{METRIC_KEYS[0]}" in archive:
            metrics = {key: archive[f"metric_{key}"] for key in METRIC_KEYS}
        else:  # Runs cached before metrics moved into the archive.
            metrics = _metrics(frames)
        run = {
            **meta, "frames": frames, "sample": archive["sample"],
            "metrics": {key: np.asarray(value).round(7).tolist() for key, value in metrics.items()},
        }
    except Exception as exc:
        raise HTTPException(500, f"Could not load cached run: {exc}") from exc
    return _remember(run_id, run)


def _run_chunk(
    seed: int, indices: list[int], diffusion_seed: int,
    progress: Callable[[float], None] | None = None,
) -> list[dict]:
    """Denoise several mazes in one batch and cache each result separately."""
    samples = _pool(seed, max(indices) + 1)
    batch = np.stack([samples[index][:2] for index in indices])
    state = torch.from_numpy(batch).to(device)
    frames = np.empty((len(indices), T, GRID_SIZE, GRID_SIZE), dtype=np.uint8)
    started = time.perf_counter()
    with MODEL_LOCK, torch.inference_mode():
        devices = [torch.cuda.current_device()] if device == "cuda" else []
        with torch.random.fork_rng(devices=devices):
            torch.manual_seed(diffusion_seed)
            if device == "cuda":
                torch.cuda.manual_seed_all(diffusion_seed)
            for timestep, path_state, prediction in sample_steps(_model(), state):
                if timestep == 0:
                    array = torch.where(path_state[:, 0] > 0, 1.0, -1.0)
                else:
                    array = prediction[:, 0].clamp(-1, 1)
                cropped = array[:, WINDOW, WINDOW].detach().cpu().numpy()
                frames[:, timestep] = np.rint((cropped + 1) * 127.5).astype(np.uint8)
                if progress and timestep % 50 == 0:
                    progress(1 - timestep / T)
    elapsed = (time.perf_counter() - started) / len(indices)
    return [
        _store_run(seed, index, diffusion_seed, samples[index], frames[position], elapsed)
        for position, index in enumerate(indices)
    ]


def _public_run(run: dict, cached: bool) -> dict:
    payload = {key: value for key, value in run.items() if key not in {"frames", "sample"}}
    return payload | {"cached": cached, "framesUrl": f"/api/runs/{run['id']}/frames"}


def _scan_worker(job: dict, req: ScanRequest) -> None:
    try:
        _pool(req.maze_seed, req.count)
        pending = [
            index for index in range(req.count)
            if req.force or not _run_paths(_run_id(req.maze_seed, index, req.diffusion_seed))[1].exists()
        ]
        job["done"] = req.count - len(pending)
        for start in range(0, len(pending), req.batch_size):
            if job["cancelled"]:
                break
            chunk = pending[start : start + req.batch_size]
            settled = job["done"]
            for meta in _run_chunk(
                req.maze_seed, chunk, req.diffusion_seed,
                lambda fraction: job.update(done=settled + fraction * len(chunk)),
            ):
                job["results"].append({
                    "index": meta["mazeIndex"], "valid": meta["valid"],
                    "settleT": meta["settleT"], "activity": meta["activity"],
                })
            job["done"] = settled + len(chunk)
        job["status"] = "cancelled" if job["cancelled"] else "done"
    except Exception as exc:  # Surface model or disk failures in the UI.
        job["status"] = "error"
        job["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        job["finished"] = time.time()


def _hex(value: str) -> tuple[int, int, int]:
    try:
        return ImageColor.getrgb(value)[:3]
    except ValueError as exc:
        raise HTTPException(400, f"Invalid color: {value}") from exc


def _font(family: str, weight: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    path = FONT_ROOT / FONT_FILES[(family, weight)]
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default(size)


def _path_clarity(frames: np.ndarray, timestep: int, open_mask: np.ndarray, gamma: float) -> int:
    """How close this frame is to the finished path, from open-cell pixels. 0 at t=999, 100 at t=0."""
    def take(index: int) -> np.ndarray:
        values = frames[index].astype(np.float32) / 255.0
        if gamma != 1.0:
            values = values ** gamma
        return values[open_mask]

    current, solved, noisy = take(timestep), take(0), take(T - 1)
    if current.size == 0:
        return 0
    span = float(np.mean(np.abs(noisy - solved)))
    if span < 1e-6:
        return 100
    score = 1.0 - float(np.mean(np.abs(current - solved))) / span
    return int(round(100 * float(np.clip(score, 0.0, 1.0))))


def _run_score(runs: list[dict | None]) -> tuple[int, int]:
    present = [run for run in runs if run is not None]
    return sum(1 for run in present if run.get("valid")), len(present)


def _status_label(solved: int, total: int) -> str:
    if total <= 0:
        return ""
    return "SOLVED" if solved > 0 else "FAILED"


def _with_score(template: str, solved: int, total: int) -> str:
    tokens = ("{solved}", "{total}", "{failed}")
    if total > 1 and not any(token in template for token in tokens):
        template = f"{template} {{solved}}/{{total}}"
    if total <= 1:
        for pattern in (" {solved}/{total}", "{solved}/{total}", " {failed}/{total}", "{failed}/{total}"):
            template = template.replace(pattern, "")
    return template


def _counter_text(
    style: TextStyle, timestep: int, frame: int, count: int, fps: float, denoised: int, solved: int, total: int,
) -> str:
    verdict = None
    if timestep == 0 and total:
        if solved <= 0 and style.failed_template:
            verdict = style.failed_template
        elif style.solved_template:
            verdict = style.solved_template
        elif style.failed_template:
            verdict = style.failed_template
    template = verdict if verdict is not None else style.template
    if verdict is not None:
        template = _with_score(template, solved, total)
    replacements = {
        "{t}": str(timestep),
        "{frame}": str(frame + 1),
        "{frames}": str(count),
        "{progress}": str(round(frame / max(count - 1, 1) * 100)),
        "{denoised}": str(denoised),
        "{seconds}": f"{frame / fps:.2f}",
        "{status}": _status_label(solved, total),
        "{solved}": str(solved),
        "{total}": str(total),
        "{failed}": str(max(0, total - solved)),
    }
    text = template
    for token, value in sorted(replacements.items(), key=lambda item: -len(item[0])):
        text = text.replace(token, value)
    return text.upper() if verdict is not None else text


def _counter_fill(style: TextStyle, value: str) -> str:
    upper = value.upper()
    if "FAILED" in upper:
        return "#e84d3d"
    if "SOLVED" in upper:
        return "#2ecc70"
    return style.color


def _text_alpha(style: TextStyle, frame: int, count: int) -> float:
    alpha = style.opacity
    if style.fade_in_frames:
        alpha *= min(1.0, frame / style.fade_in_frames)
    if style.fade_out_frames:
        alpha *= min(1.0, (count - 1 - frame) / style.fade_out_frames)
    return max(0.0, min(1.0, alpha))


def _tile_boxes(style: RenderStyle, count: int) -> list[tuple[int, int, int]]:
    """Where each maze sits on the canvas. One box, or nine for a 3×3.

    The maze fills the padded area so a 0 px frame pad does not leave a leftover
    background band. Scaling is still nearest-neighbour from the cell grid.
    """
    cells = GRID_SIZE + style.border_cells * 2
    width = style.resolution - style.pad_left - style.pad_right
    height = style.resolution - style.pad_top - style.pad_bottom
    cols = 3 if count > 1 else 1
    rows = 3 if count > 1 else 1
    gap = style.grid_gap if count > 1 else 0
    raw = min((width - gap * (cols - 1)) // cols, (height - gap * (rows - 1)) // rows)
    size = max(cells, raw)
    block_w = size * cols + gap * (cols - 1)
    block_h = size * rows + gap * (rows - 1)
    x0 = style.pad_left + (width - block_w) // 2
    y0 = style.pad_top + (height - block_h) // 2
    if style.pad_top > style.pad_bottom:
        y0 = style.pad_top
    elif style.pad_bottom > style.pad_top:
        y0 = style.resolution - style.pad_bottom - block_h
    if style.pad_left > style.pad_right:
        x0 = style.pad_left
    elif style.pad_right > style.pad_left:
        x0 = style.resolution - style.pad_right - block_w
    return [
        (x0 + column * (size + gap), y0 + row * (size + gap), size)
        for row in range(rows)
        for column in range(cols)
    ]


def _resolve_runs(run_id: str, run_ids: list[str]) -> list[dict | None]:
    ids = list(run_ids) if run_ids else [run_id]
    if not any(ids):
        raise HTTPException(400, "No runs to render.")
    if len(ids) > 1:
        ids = (ids + [""] * 9)[:9]
    resolved: list[dict | None] = []
    for item in ids:
        resolved.append(_load_run(item) if item else None)
    return resolved


def _maze_tile(run: dict, timestep: int, style: RenderStyle) -> tuple[Image.Image, np.ndarray]:
    """Cell-resolution maze image and the 23×23 open-cell mask."""
    grid, _, start, stop = maze.parse_sample(run["sample"])
    grid = grid[WINDOW, WINDOW]
    start = (start[0] - OFFSET, start[1] - OFFSET)
    stop = (stop[0] - OFFSET, stop[1] - OFFSET)

    wall = np.array(_hex(style.wall_color), dtype=np.float32)
    opened = np.array(_hex(style.open_color), dtype=np.float32)
    path = np.array(_hex(style.path_color), dtype=np.float32)
    base = np.empty((GRID_SIZE, GRID_SIZE, 3), dtype=np.float32)
    base[:] = opened
    base[grid == 0] = wall
    strength = run["frames"][timestep].astype(np.float32) / 255.0
    if style.gamma != 1.0:
        strength = strength ** style.gamma
    if style.mask_prediction:
        strength = strength * (grid != 0)
    image = base * (1 - strength[..., None]) + path * strength[..., None]
    image[start] = _hex(style.start_color)
    image[stop] = _hex(style.goal_color)
    border = style.border_cells
    if border:
        padded = np.empty((GRID_SIZE + border * 2, GRID_SIZE + border * 2, 3), dtype=np.uint8)
        padded[:] = wall.astype(np.uint8)
        padded[border:-border, border:-border] = np.rint(image).astype(np.uint8)
    else:
        padded = np.rint(image).astype(np.uint8)
    return Image.fromarray(padded, "RGB"), grid != 0


def _render_canvas(
    runs: list[dict | None], timestep: int, index: int, count: int, fps: float, style: RenderStyle,
) -> Image.Image:
    timestep = int(np.clip(timestep, 0, T - 1))
    boxes = _tile_boxes(style, 9 if len(runs) > 1 else 1)
    result = Image.new("RGB", (style.resolution, style.resolution), _hex(style.background))
    clarities: list[int] = []
    for run, box in zip(runs, boxes):
        if run is None:
            continue
        tile, open_mask = _maze_tile(run, timestep, style)
        result.paste(tile.resize((box[2], box[2]), Image.Resampling.NEAREST), (box[0], box[1]))
        clarities.append(_path_clarity(run["frames"], timestep, open_mask, style.gamma))

    text_style = style.text
    alpha = _text_alpha(text_style, index, count)
    if not text_style.enabled or alpha <= 0:
        return result
    denoised = int(round(sum(clarities) / len(clarities))) if clarities else 0
    solved, total = _run_score(runs)
    text = _counter_text(text_style, timestep, index, count, fps, denoised, solved, total)
    if not text:
        return result
    font = _font(text_style.family, text_style.weight, text_style.size)
    layer = Image.new("RGBA", result.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bbox = draw.textbbox((0, 0), text, font=font, stroke_width=text_style.outline)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad, margin = text_style.padding, text_style.margin
    span_x, span_y = style.resolution - tw - pad * 2, style.resolution - th - pad * 2
    horizontal = {"left": margin, "center": span_x // 2, "right": span_x - margin}
    vertical = {"top": margin, "center": span_y // 2, "bottom": span_y - margin}
    row, _, column = text_style.position.partition("-")
    x = horizontal.get(column or "center", margin) + text_style.offset_x
    y = vertical.get(row, margin) + text_style.offset_y
    bg = (*_hex(text_style.background), round(text_style.background_opacity * 255))
    if bg[3]:
        draw.rounded_rectangle((x, y, x + tw + pad * 2, y + th + pad * 2), radius=text_style.radius, fill=bg)
    tx, ty = x + pad - bbox[0], y + pad - bbox[1]
    fill = (*_hex(_counter_fill(text_style, text)), 255)
    if text_style.shadow:
        draw.text((tx + 2, ty + 2), text, font=font, fill=(0, 0, 0, 150), stroke_width=text_style.outline)
    draw.text(
        (tx, ty), text, font=font, fill=fill,
        stroke_width=text_style.outline, stroke_fill=(0, 0, 0, 255),
    )
    if alpha < 1:
        layer.putalpha(layer.getchannel("A").point(lambda value: round(value * alpha)))
    return Image.alpha_composite(result.convert("RGBA"), layer).convert("RGB")


def _quantize(frames: list[Image.Image], colors: int, dither: bool, keys: list[tuple[int, int, int]]) -> list[Image.Image]:
    """One shared adaptive palette keeps GIF frames stable and small."""
    width, height = frames[0].size
    samples = frames[:: max(1, len(frames) // 12)][:12]
    # The start and goal are a single cell each, so median cut would happily drop
    # them at low colour counts. Weighting a band of the exact palette colours
    # guarantees each one keeps its own slot.
    band = max(1, height // 4)
    strip = Image.new("RGB", (width, height * len(samples) + band))
    for slot, source in enumerate(samples):
        strip.paste(source, (0, slot * height))
    draw = ImageDraw.Draw(strip)
    for index, key in enumerate(keys):
        left = round(width * index / len(keys))
        right = round(width * (index + 1) / len(keys))
        draw.rectangle((left, height * len(samples), right, strip.height), fill=key)
    palette = strip.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    mode = Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE
    return [frame.quantize(palette=palette, dither=mode) for frame in frames]


def _frame_durations_ms(count: int, fps: float, start_hold_ms: int, end_hold_ms: int, gif: bool) -> list[int]:
    """Per-frame display time. GIF delays below 20ms play as 100ms in browsers."""
    raw = 1000.0 / fps
    durations = [raw] * count
    durations[0] += start_hold_ms
    durations[-1] += end_hold_ms
    if not gif:
        return [max(1, round(ms)) for ms in durations]
    # Pillow writes delay as int(ms / 10) hundredths of a second. A value of 1
    # (10ms, which 60 fps rounds to) is treated as 100ms by Chrome, Firefox,
    # Safari, and Discord — so a 5s clip becomes ~30s. Floor at 20ms (50 fps).
    return [max(20, round(ms / 10) * 10) for ms in durations]


def _export(req: ExportRequest) -> tuple[Path, str]:
    runs = _resolve_runs(req.run_id, req.run_ids)
    schedule = [int(np.clip(t, 0, T - 1)) for t in req.schedule]
    frames = [
        _render_canvas(runs, timestep, index, len(schedule), req.fps, req.render)
        for index, timestep in enumerate(schedule)
    ]
    durations = _frame_durations_ms(len(frames), req.fps, req.start_hold_ms, req.end_hold_ms, gif=req.format == "gif")
    first = next(run["id"] for run in runs if run is not None)
    tag = "grid3" if len(runs) > 1 else first
    stem = f"denoise-{tag}-{uuid.uuid4().hex[:8]}"

    if req.format in {"gif", "apng"}:
        suffix = ".gif" if req.format == "gif" else ".png"
        output = EXPORT_ROOT / f"{stem}{suffix}"
        keys = [_hex(color) for color in (
            req.render.open_color, req.render.wall_color, req.render.path_color,
            req.render.start_color, req.render.goal_color,
        )]
        saved = _quantize(frames, req.colors, req.dither, keys) if req.format == "gif" else frames
        kwargs = {
            "save_all": True, "append_images": saved[1:], "duration": durations,
            "loop": 0 if req.loop else 1,
        }
        if req.format == "gif":
            kwargs |= {"optimize": True, "disposal": 2}
        saved[0].save(output, **kwargs)
        return output, "image/gif" if req.format == "gif" else "image/apng"

    if req.format == "png-zip":
        output = EXPORT_ROOT / f"{stem}-frames.zip"
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, (frame, timestep) in enumerate(zip(frames, schedule)):
                buffer = io.BytesIO()
                frame.save(buffer, "PNG")
                archive.writestr(f"frame-{index + 1:04d}-t{timestep:04d}.png", buffer.getvalue())
            archive.writestr("schedule.json", json.dumps({"timesteps": schedule, "durationsMs": durations}, indent=2))
        return output, "application/zip"

    if not shutil.which("ffmpeg"):
        raise HTTPException(501, "ffmpeg is required for MP4 and WebM exports.")
    suffix = ".mp4" if req.format == "mp4" else ".webm"
    output = EXPORT_ROOT / f"{stem}{suffix}"
    with tempfile.TemporaryDirectory(prefix="denoise-studio-") as tmp:
        temp_root = Path(tmp)
        manifest_lines: list[str] = []
        for index, (frame, duration) in enumerate(zip(frames, durations)):
            path = temp_root / f"frame-{index:04d}.png"
            frame.save(path)
            manifest_lines.extend([f"file '{path}'", f"duration {duration / 1000:.6f}"])
        manifest_lines.append(f"file '{temp_root / f'frame-{len(frames) - 1:04d}.png'}'")
        manifest = temp_root / "frames.txt"
        manifest.write_text("\n".join(manifest_lines))
        if req.format == "mp4":
            codec = ["-c:v", "libx264", "-crf", str(round(31 - req.quality * 0.18)), "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        else:
            codec = ["-c:v", "libvpx-vp9", "-crf", str(round(55 - req.quality * 0.35)), "-b:v", "0", "-pix_fmt", "yuv420p"]
        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
            "-i", str(manifest), "-vsync", "vfr", *codec, str(output),
        ]
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode:
            raise HTTPException(500, f"ffmpeg export failed: {completed.stderr[-500:]}")
    return output, "video/mp4" if req.format == "mp4" else "video/webm"


def _export_entry(path: Path) -> dict:
    stat = path.stat()
    return {
        "filename": path.name, "bytes": stat.st_size, "modified": stat.st_mtime,
        "url": f"/api/exports/{path.name}",
    }


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "device": device,
        "modelLoaded": MODEL is not None,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "fonts": all((FONT_ROOT / name).exists() for name in FONT_FILES.values()),
        "timesteps": T,
        "gridSize": GRID_SIZE,
    }


@app.post("/api/mazes")
def generate_mazes(req: MazeRequest) -> dict:
    samples = _pool(req.seed, req.count)
    runs = _cached_runs(req.seed, req.diffusion_seed)
    return {
        "seed": req.seed,
        "count": len(samples),
        "mazes": [
            _maze_summary(sample, index, req.seed, runs.get(index, []))
            for index, sample in enumerate(samples)
        ],
    }


@app.post("/api/runs")
def analyze_run(req: RunRequest) -> dict:
    run_id = _run_id(req.maze_seed, req.maze_index, req.diffusion_seed)
    data_path, meta_path = _run_paths(run_id)
    if not req.force and data_path.exists() and meta_path.exists():
        return _public_run(_load_run(run_id), cached=True)
    if req.maze_index >= len(_pool(req.maze_seed, req.maze_index + 1)):
        raise HTTPException(404, "Maze index is outside the generated pool.")
    _run_chunk(req.maze_seed, [req.maze_index], req.diffusion_seed)
    return _public_run(_load_run(run_id), cached=False)


@app.get("/api/runs/{run_id}/frames")
def run_frames(run_id: str) -> Response:
    run = _load_run(run_id)
    return Response(
        content=run["frames"].tobytes(), media_type="application/octet-stream",
        headers={"X-Shape": ",".join(map(str, run["frames"].shape)), "Cache-Control": "no-store"},
    )


@app.post("/api/scan")
def start_scan(req: ScanRequest) -> dict:
    if any(job["status"] == "running" for job in SCANS.values()):
        raise HTTPException(409, "A scan is already running.")
    job_id = uuid.uuid4().hex[:8]
    job = {
        "id": job_id, "status": "running", "done": 0, "total": req.count,
        "results": [], "error": None, "cancelled": False, "started": time.time(), "finished": None,
    }
    SCANS.clear()
    SCANS[job_id] = job
    threading.Thread(target=_scan_worker, args=(job, req), daemon=True).start()
    return {"jobId": job_id, "total": req.count}


@app.get("/api/scan/{job_id}")
def scan_status(job_id: str) -> dict:
    job = SCANS.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found.")
    return {key: value for key, value in job.items() if key != "cancelled"}


@app.post("/api/scan/{job_id}/cancel")
def cancel_scan(job_id: str) -> dict:
    job = SCANS.get(job_id)
    if not job:
        raise HTTPException(404, "Scan job not found.")
    job["cancelled"] = True
    return {"ok": True}


@app.post("/api/frame")
def render_frame(req: FrameRequest) -> Response:
    runs = _resolve_runs(req.run_id, req.run_ids)
    image = _render_canvas(runs, req.timestep, req.index, req.count, req.fps, req.render)
    if req.format == "gif":
        keys = [_hex(color) for color in (
            req.render.open_color, req.render.wall_color, req.render.path_color,
            req.render.start_color, req.render.goal_color,
        )]
        image = _quantize([image], req.colors, req.dither, keys)[0].convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return Response(content=buffer.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


@app.post("/api/export")
def create_export(req: ExportRequest) -> dict:
    output, mime = _export(req)
    return _export_entry(output) | {"mime": mime}


@app.get("/api/exports")
def list_exports() -> dict:
    files = sorted(EXPORT_ROOT.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True)
    return {"exports": [_export_entry(path) for path in files if path.is_file()]}


@app.get("/api/exports/{filename}")
def download_export(filename: str) -> FileResponse:
    path = EXPORT_ROOT / Path(filename).name
    if not path.exists() or path.name != filename:
        raise HTTPException(404, "Export not found.")
    return FileResponse(path, filename=path.name)


@app.delete("/api/exports/{filename}")
def delete_export(filename: str) -> dict:
    path = EXPORT_ROOT / Path(filename).name
    if not path.exists() or path.name != filename:
        raise HTTPException(404, "Export not found.")
    path.unlink()
    return {"ok": True}


@app.get("/api/fonts/{family}-{weight}.ttf")
def font_file(family: str, weight: str) -> FileResponse:
    path = FONT_ROOT / FONT_FILES.get((family, weight), "")
    if not path.name or not path.exists():
        raise HTTPException(404, "Font not installed on this machine.")
    return FileResponse(path, media_type="font/ttf", headers={"Cache-Control": "public, max-age=86400"})


if STATIC_ROOT.exists() and (STATIC_ROOT / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_ROOT / "assets"), name="assets")

    @app.get("/{path:path}")
    def frontend(path: str = ""):
        candidate = STATIC_ROOT / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_ROOT / "index.html")
else:
    @app.get("/", response_class=HTMLResponse)
    def missing_frontend() -> str:
        return "<h1>Denoise Studio</h1><p>Build the frontend with <code>cd gif_studio/web &amp;&amp; npm install &amp;&amp; npm run build</code>.</p>"


if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("DENOISE_STUDIO_HOST", "127.0.0.1"), port=int(os.environ.get("DENOISE_STUDIO_PORT", "7861")))
