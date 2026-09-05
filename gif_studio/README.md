# Denoise Studio

A local, disposable workbench for turning a real 1,000-step diffusion run into a
showcase animation of a maze solving itself. Nothing here is imported by the
project: delete the folder once the GIF is finished.

## Run

From the repository root:

```bash
cd gif_studio/web && npm install && npm run build && cd ../..
uv run python gif_studio/server.py
```

Open <http://127.0.0.1:7861>. For frontend work, `npm run dev` in `gif_studio/web`
serves on :5173 and proxies `/api` to the Python server.

Runs are cached in `gif_studio/.cache/`, exported files land in `gif_studio/exports/`.
Both are ignored by Git and safe to delete at any time.

## Workflow

1. **Pick a maze.** *Generate* builds a seeded gallery; each maze is derived from its
   own sub-seed, so maze #37 is the same whether the pool holds 48 or 400.
   *Run all N through the model* denoises the whole pool in GPU batches (about 15s for
   96 mazes on CUDA) and caches every run, so selecting a maze afterwards is instant.

   Filters:
   - **Search** understands phrases like `top left to bottom right`, `far apart`,
     `long`, `twisty`, `many decisions`, `solved`, and `#12`.
     Matched terms show up as chips under the box.
   - **Preset chips** — *Corners*, *Far*, *Opposite*, *Top ↔ bottom*, *Long*, *Twisty*,
     *Fills*, *Late*, *Decisions*. Click again to undo one.
   - **Zone pickers** for where the endpoints sit. Click cells in the Start and Goal
     grids; pick several cells for "anywhere down the left edge". The ⇄ button decides
     whether the two ends are interchangeable or the order is literal.
   - **Ranges** (funnel button) for endpoint distance, path length, turns, coverage,
     `settles at t`, and **decisions**. A decision is a T or cross on the solution where
     a wrong turn was possible. Walking a corridor, even a bending one, does not count.
     *Avoided* is how many wrong exits the path skipped (a 4-way counts more than a T).
     Sort by *Most right decisions* to put the choosiest paths first. Low settle values
     keep moving until the end, which animates better.
   - **Run state**: All, Solved, Failed, New. Validity is only known once a maze has
     been through the model.

   Switch the runbar (or Look tab) to **3×3** for nine mazes on one timeline. Click
   mazes to fill slots, click again to remove one, or **Fill 3×3** to take the first
   nine in the current gallery order. Empty slots stay blank. Equal-change timing
   averages the nine runs, and `{denoised}` is their mean path clarity. 768 or 1024
   looks better than 512 for a grid.

2. **Shape the time mapping.** The graph maps playback position (x) to progress through
   the denoising run (y), and is always monotonic.
   - **Equal timesteps** walks `t` evenly from 999 to 0.
   - **Equal change** (default) walks evenly through *accumulated visual change*, so a
     straight line yields frames that each move the picture by the same amount. This
     matters: most of the movement happens in the first couple of hundred steps, so a
     linear-in-`t` animation spends half its frames on a picture that has stopped moving.
     The *Evenness* readout and the grey bars behind the curve show how flat the
     per-frame change actually is.
   - Double-click to add a keypoint, drag to move it, and set the interpolation used
     after each point. The filmstrip under the graph shows the frames the current curve
     really samples; click it to jump.

3. **Tune the look and the counter.** Colours, canvas size, cell border, prediction
   gamma, and whether the noise shows over walls. **Keep text off maze** (on by default)
   insets the maze so the counter sits in an empty band. **Frame padding** adds extra
   inset on top of that — link the four sides or set each on its own. The maze
   fills whatever is left, so 0 px padding goes edge to edge.

   Then the counter: template (`{t}`, `{frame}`, `{progress}`, `{denoised}`,
   `{seconds}`, `{status}`, `{solved}`, `{total}`). `{denoised}` is how close the
   open-cell pixels are to the finished path — not a rescaling of `t`. `{status}`
   is **SOLVED** (green) or **FAILED** (red), all caps. On a 3×3 the last frame
   becomes **SOLVED 8/9** (or **FAILED 0/9** if none made it); a single maze stays
   **SOLVED** / **FAILED**. Leave those templates empty to keep counting.

4. **Export.** GIF (with palette size and dithering), MP4, WebM, APNG or a ZIP of PNG
   frames. GIF quantisation is pinned so the start and goal cells keep their exact
   colours even at small palettes. Recent files are listed in the Export tab and can be
   downloaded again or deleted.

Keyboard: Space plays, arrows step frames, `K` adds a keypoint, Delete removes the
selected one, Ctrl/Cmd Z and Shift Z undo and redo curve edits.

## Preview accuracy

The canvas preview and the exporter share the same drawing rules, and the browser loads
the very same DejaVu font files the exporter draws with, so what you see is what you get.
The two rasterise text edges slightly differently; the maze pixels are identical. The
eye button next to *Analyze* overlays a real Pillow frame (and the GIF palette, when
that is the export format) without changing the preview layout. While a new frame is
rendering, or while playback is running, the live canvas shows through so Look / Text /
Export tweaks stay visible.

## Notes

- A run is identified by (maze seed, maze index, diffusion seed) and cached on disk.
  The diffusion seed picks which noise the run starts from, so it is the knob for
  "solve this same maze a different way".
- MP4 and WebM need `ffmpeg` on PATH; the buttons are disabled when it is missing.
