"use client";

import type { ReactNode } from "react";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  const styles =
    variant === "primary"
      ? "bg-fg text-bg hover:bg-fg/88"
      : "border border-line bg-bg text-fg hover:bg-surface hover:border-faint/40";
  return <button type="button" {...props} className={`${base} h-9 px-3.5 ${styles} ${className}`} />;
}

export function IconButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`${base} h-9 w-9 border border-line bg-bg text-muted hover:bg-surface hover:text-fg ${className}`}
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

export function Segmented<T extends string>({ value, onChange, options, className = "", ...rest }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={`flex gap-0.5 rounded-lg border border-line bg-surface p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-sm transition-colors duration-200 ${
            value === option.value
              ? "bg-bg text-fg shadow-[0_1px_2px_rgb(0_0_0/0.05)] ring-1 ring-line"
              : "text-muted hover:text-fg"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SelectProps<T extends string> extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; title?: string }[];
}

export function Select<T extends string>({ value, onChange, options, className = "", ...rest }: SelectProps<T>) {
  return (
    <div className={`relative ${className}`}>
      <select
        {...rest}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-line bg-bg pr-8 pl-3 text-sm text-fg transition-colors duration-200 hover:bg-surface"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="pointer-events-none absolute top-1/2 right-3 h-3 w-3 -translate-y-1/2 text-faint"
      >
        <path d="M3 4.75 6 7.75 9 4.75" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}
