"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/**
 * The theme lives as a class on <html>, set by the blocking script in the
 * layout before first paint. Everything that needs to know — the toggle, the
 * canvas palette — subscribes to that class rather than keeping a second copy
 * of the truth in React state.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, getTheme, () => null);
}
