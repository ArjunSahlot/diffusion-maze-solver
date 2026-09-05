"use client";

import type { ReactNode } from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  const styles =
    variant === "primary"
      ? "bg-foreground text-background hover:bg-foreground/85"
      : "border border-line text-foreground hover:bg-surface";
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center rounded-md px-3.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 ${styles} ${className}`}
    />
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  "aria-label": string;
  className?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = "",
  ...rest
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={`flex gap-0.5 rounded-md border border-line bg-surface p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
            value === option.value
              ? "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-line"
              : "text-muted hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
