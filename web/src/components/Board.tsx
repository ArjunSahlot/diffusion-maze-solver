"use client";

import { useEffect, useMemo, useRef } from "react";

import { GRID, isInterior, type Cell } from "@/lib/maze";
import { drawMaze, readPalette, type Board as BoardModel } from "@/lib/render";
import { useTheme } from "@/lib/theme";

export type Marker = "start" | "goal";

interface Props extends BoardModel {
  /** `erase` is set when the stroke is inverted with shift or the right button. */
  onPaint: (r: number, c: number, erase: boolean) => void;
  /** `marker` is set when the stroke picked up an endpoint rather than the brush. */
  onStrokeStart: (marker: Marker | null) => void;
  onMoveMarker: (marker: Marker, r: number, c: number) => void;
  erasing: boolean;
  label: string;
}

const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/**
 * The maze surface.
 *
 * Pointing at an endpoint picks it up, so the markers can be dragged around without
 * reaching for a tool; anywhere else paints. Strokes are interpolated between pointer
 * events so a quick drag does not leave gaps, and the canvas is redrawn at device
 * resolution whenever it is resized or the theme changes.
 */
export function Board({ onPaint, onStrokeStart, onMoveMarker, erasing, label, ...board }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef(0);
  const lastCell = useRef<Cell | null>(null);
  const dragging = useRef<Marker | "paint" | null>(null);
  const inverted = useRef(false);
  const theme = useTheme();
  // `theme` is null until hydration, which is also when the CSS tokens can first be read.
  const palette = useMemo(() => theme && readPalette(), [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !palette) return;

    const render = () => {
      const size = sizeRef.current;
      if (!size) return;
      // Draw in device pixels so every wall edge lands on a whole pixel and stays crisp.
      const backing = Math.round(size * (window.devicePixelRatio || 1));
      if (canvas.width !== backing) canvas.width = canvas.height = backing;
      drawMaze(context, backing, board, palette);
    };

    const observer = new ResizeObserver(([entry]) => {
      sizeRef.current = entry.contentRect.width;
      render();
    });
    observer.observe(canvas);
    render();
    return () => observer.disconnect();
  }, [board, palette]);

  const cellAt = (event: React.PointerEvent<HTMLCanvasElement>): Cell | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const r = Math.floor(((event.clientY - rect.top) / rect.height) * GRID);
    const c = Math.floor(((event.clientX - rect.left) / rect.width) * GRID);
    return isInterior(r, c) ? [r, c] : null;
  };

  const markerAt = (cell: Cell): Marker | null =>
    sameCell(cell, board.start) ? "start" : sameCell(cell, board.goal) ? "goal" : null;

  const paintTo = (cell: Cell) => {
    const erase = inverted.current ? !erasing : erasing;
    const previous = lastCell.current;
    if (previous) {
      // Walk the segment since the last event so fast drags stay continuous.
      const steps = Math.max(Math.abs(cell[0] - previous[0]), Math.abs(cell[1] - previous[1]));
      for (let i = 1; i <= steps; i++) {
        const r = Math.round(previous[0] + ((cell[0] - previous[0]) * i) / steps);
        const c = Math.round(previous[1] + ((cell[1] - previous[1]) * i) / steps);
        if (isInterior(r, c)) onPaint(r, c, erase);
      }
    } else {
      onPaint(cell[0], cell[1], erase);
    }
    lastCell.current = cell;
  };

  const stop = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = null;
    lastCell.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="aspect-square w-full touch-none rounded-xl border border-line select-none"
      style={{ cursor: "crosshair" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        const cell = cellAt(event);
        if (!cell) return;
        // Capture keeps a drag alive past the edge of the board; it is not required to draw.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
        lastCell.current = null;
        inverted.current = event.shiftKey || event.button === 2;

        const marker = markerAt(cell);
        onStrokeStart(marker);
        dragging.current = marker ?? "paint";
        if (marker) event.currentTarget.style.cursor = "grabbing";
        else paintTo(cell);
      }}
      onPointerMove={(event) => {
        const cell = cellAt(event);
        if (!dragging.current) {
          // Endpoints advertise that they can be picked up, without costing a re-render.
          event.currentTarget.style.cursor = cell && markerAt(cell) ? "grab" : "crosshair";
          return;
        }
        if (!cell) return;
        if (dragging.current === "paint") paintTo(cell);
        else onMoveMarker(dragging.current, cell[0], cell[1]);
      }}
      onPointerUp={(event) => {
        event.currentTarget.style.cursor = "crosshair";
        stop(event);
      }}
      onPointerCancel={stop}
    />
  );
}
