"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SolverEvent } from "./solver.worker";

/** Frames often arrive faster than they can be read, so playback is paced to stay watchable. */
const MIN_FRAME_MS = 45;

export interface SolverStatus {
  phase: "starting" | "downloading" | "preparing" | "ready" | "failed";
  backend?: string;
  received?: number;
  total?: number;
  message?: string;
}

export function useSolver(onSettled: (prediction: Float32Array) => void) {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<SolverStatus>({ phase: "starting" });
  const [prediction, setPrediction] = useState<Float32Array | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);

  // Playback state lives in refs so the pump is not restarted on every render.
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);
  const queue = useRef<{ x0: Float32Array; progress: number }[]>([]);
  const streamDone = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  const stopPlayback = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queue.current = [];
    streamDone.current = false;
  }, []);

  const pump = useCallback(() => {
    if (timer.current) return;
    const tick = () => {
      timer.current = null;
      const frame = queue.current.shift();
      if (frame) {
        setPrediction(frame.x0);
        setProgress(frame.progress);
        if (!queue.current.length && streamDone.current) {
          setRunning(false);
          settled.current(frame.x0);
          return;
        }
        timer.current = setTimeout(tick, MIN_FRAME_MS);
      } else if (!streamDone.current) {
        timer.current = setTimeout(tick, MIN_FRAME_MS);
      }
    };
    tick();
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<SolverEvent>) => {
      if (data.type === "downloading") {
        setStatus({ phase: "downloading", received: data.received, total: data.total });
      } else if (data.type === "preparing") {
        setStatus({ phase: "preparing" });
      } else if (data.type === "ready") {
        setStatus({ phase: "ready", backend: data.backend });
      } else if (data.type === "error") {
        setStatus({ phase: "failed", message: data.message });
        setRunning(false);
        stopPlayback();
      } else if (data.id !== requestId.current) {
        // A stale solve the user has already moved on from.
      } else if (data.type === "frame") {
        queue.current.push({ x0: data.x0, progress: data.progress });
        pump();
      } else if (data.type === "done") {
        streamDone.current = true;
      }
    };
    worker.postMessage({ type: "load" });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [pump, stopPlayback]);

  const cancel = useCallback(() => {
    requestId.current++;
    workerRef.current?.postMessage({ type: "cancel" });
    stopPlayback();
    setRunning(false);
    setProgress(0);
    setPrediction(null);
  }, [stopPlayback]);

  const solve = useCallback(
    (state: Float32Array, steps: number) => {
      const worker = workerRef.current;
      if (!worker) return;
      requestId.current++;
      stopPlayback();
      setPrediction(null);
      setProgress(0);
      setRunning(true);
      worker.postMessage({ type: "solve", id: requestId.current, state, steps }, [state.buffer]);
    },
    [stopPlayback],
  );

  return { status, prediction, progress, running, solve, cancel };
}
