"use client";

import { forwardRef } from "react";

// Usage:
// <Button variant="primary" size="md">BET YES</Button>
// <Button variant="secondary" size="sm" loading>Processing...</Button>
// <Button variant="danger" size="lg" fullWidth>Cancel Market</Button>
// <Button variant="ghost" size="sm">Cancel</Button>

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  loading?: boolean;
}

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, React.CSSProperties> = {
  primary: {
    // handled by btn-primary class
  },
  secondary: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  },
  danger: {
    background: "var(--danger)",
    color: "#000",
  },
  ghost: {
    background: "transparent",
    color: "var(--text)",
  },
};

const variantHoverStyles: Record<NonNullable<ButtonProps["variant"]>, React.CSSProperties> = {
  primary: {},
  secondary: {
    borderColor: "rgba(255,255,255,0.15)",
    background: "#1a1a1a",
  },
  danger: {
    background: "#cc3333",
    boxShadow: "0 0 20px rgba(255,68,68,0.4)",
  },
  ghost: {
    background: "var(--surface)",
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      fullWidth = false,
      loading = false,
      disabled,
      children,
      className = "",
      onMouseEnter,
      onMouseLeave,
      style,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    const baseClasses = [
      "inline-flex items-center justify-center gap-2",
      "rounded-md font-mono font-semibold tracking-wider",
      "transition-all cursor-pointer",
      "select-none",
      sizeClasses[size],
      variant === "primary" ? "btn-primary" : "",
      fullWidth ? "w-full" : "",
      isDisabled ? "opacity-35 cursor-not-allowed pointer-events-none" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    function handleMouseEnter(e: React.MouseEvent<HTMLButtonElement>) {
      if (!isDisabled) {
        const hoverStyle = variantHoverStyles[variant];
        for (const [key, value] of Object.entries(hoverStyle)) {
          (e.currentTarget.style as unknown as Record<string, string>)[key] = value as string;
        }
      }
      onMouseEnter?.(e);
    }

    function handleMouseLeave(e: React.MouseEvent<HTMLButtonElement>) {
      if (!isDisabled) {
        const baseStyle = variantStyles[variant];
        const hoverStyle = variantHoverStyles[variant];
        // Reset only the keys that were changed on hover
        for (const key of Object.keys(hoverStyle)) {
          const baseValue = (baseStyle as Record<string, string>)[key] ?? "";
          (e.currentTarget.style as unknown as Record<string, string>)[key] = baseValue;
        }
      }
      onMouseLeave?.(e);
    }

    return (
      <button
        ref={ref}
        className={baseClasses}
        disabled={isDisabled}
        style={{ ...variantStyles[variant], ...style }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        {loading && (
          <span
            className="shrink-0"
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              borderRadius: "50%",
              border: "2px solid currentColor",
              borderTopColor: "transparent",
              animation: "spin 0.7s linear infinite",
            }}
          />
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
