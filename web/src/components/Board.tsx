"use client";

import { useEffect, useRef } from "react";

import { GRID, isInterior } from "@/lib/maze";
import { DARK, LIGHT, drawMaze, type Board as BoardModel } from "@/lib/render";
import { usePrefersDark } from "@/lib/usePrefersDark";

interface Props extends BoardModel {
  onPaint: (r: number, c: number) => void;
  cursor: string;
  label: string;
}

/**
 * The maze surface. Painting is interpolated between pointer events so a quick drag
 * does not leave gaps, and the canvas is redrawn at device resolution on resize.
 */
export function Board({ onPaint, cursor, label, ...board }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef(0);
  const lastCell = useRef<[number, number] | null>(null);
  const drawing = useRef(false);
  const dark = usePrefersDark();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const render = () => {
      const size = sizeRef.current;
      if (!size) return;
      // Draw in device pixels so every wall edge lands on a whole pixel and stays crisp.
      const backing = Math.round(size * (window.devicePixelRatio || 1));
      if (canvas.width !== backing) canvas.width = canvas.height = backing;
      drawMaze(context, backing, board, dark ? DARK : LIGHT);
    };

    const observer = new ResizeObserver(([entry]) => {
      sizeRef.current = entry.contentRect.width;
      render();
    });
    observer.observe(canvas);
    render();
    return () => observer.disconnect();
  }, [board, dark]);

  const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    lastCell.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cellAt = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const r = Math.floor(((event.clientY - rect.top) / rect.height) * GRID);
    const c = Math.floor(((event.clientX - rect.left) / rect.width) * GRID);
    return isInterior(r, c) ? [r, c] : null;
  };

  const paintTo = (cell: [number, number], first: boolean) => {
    const previous = lastCell.current;
    if (previous && !first) {
      // Walk the segment since the last event so fast drags stay continuous.
      const steps = Math.max(Math.abs(cell[0] - previous[0]), Math.abs(cell[1] - previous[1]));
      for (let i = 1; i <= steps; i++) {
        const r = Math.round(previous[0] + ((cell[0] - previous[0]) * i) / steps);
        const c = Math.round(previous[1] + ((cell[1] - previous[1]) * i) / steps);
        if (isInterior(r, c)) onPaint(r, c);
      }
    } else {
      onPaint(cell[0], cell[1]);
    }
    lastCell.current = cell;
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="w-full aspect-square rounded-lg border border-line bg-background touch-none select-none"
      style={{ cursor }}
      onPointerDown={(event) => {
        drawing.current = true;
        lastCell.current = null;
        // Capture keeps a drag alive past the edge of the board; it is not required to draw.
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {}
        const cell = cellAt(event);
        if (cell) paintTo(cell, true);
      }}
      onPointerMove={(event) => {
        if (!drawing.current) return;
        const cell = cellAt(event);
        if (cell) paintTo(cell, false);
      }}
      onPointerUp={stopDrawing}
      onPointerCancel={stopDrawing}
    />
  );
}
