"use client";

import { useCallback } from "react";
import type { MouseEvent } from "react";

import { applyTheme, getTheme, useTheme } from "@/lib/theme";

/**
 * Where the browser supports it, the new theme is revealed as a circle growing
 * out of the button itself, so the switch reads as one gesture rather than a
 * page-wide flash. Everywhere else it just changes, which is fine.
 */
export function ThemeToggle() {
  const theme = useTheme();

  const toggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const next = getTheme() === "dark" ? "light" : "dark";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!document.startViewTransition || reduced) {
      applyTheme(next);
      return;
    }

    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const root = document.documentElement;
    const transition = document.startViewTransition(() => {
      // Commit the final colours before the browser captures the new view.
      root.dataset.themeTransition = "";
      applyTheme(next);
      void root.offsetWidth;
      delete root.dataset.themeTransition;
    });
    transition.ready.then(
      () =>
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 500, easing: "ease-in", pseudoElement: "::view-transition-new(root)" },
        ),
      () => undefined,
    );
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === null ? "Toggle theme" : `Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="-m-2 cursor-pointer rounded-md p-2 text-faint transition-colors duration-200 hover:bg-surface hover:text-fg"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="theme-icon"
      >
        <path className="theme-icon-moon" d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5a8.5 8.5 0 1 0 10.6 10.6Z" />
        <g className="theme-icon-sun">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2.25v2M12 19.75v2M4.25 12h-2M21.75 12h-2M5.1 5.1 3.7 3.7M20.3 20.3l-1.4-1.4M18.9 5.1l1.4-1.4M3.7 20.3l1.4-1.4" />
        </g>
      </svg>
    </button>
  );
}
