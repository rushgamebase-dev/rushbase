import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Primary colors
        primary: {
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
        },
        // Trading colors
        long: {
          DEFAULT: "#22c55e",
          light: "#4ade80",
          dark: "#16a34a",
          muted: "rgba(34, 197, 94, 0.1)",
        },
        short: {
          DEFAULT: "#ef4444",
          light: "#f87171",
          dark: "#dc2626",
          muted: "rgba(239, 68, 68, 0.1)",
        },
        // Background colors
        background: {
          DEFAULT: "#0a0a0b",
          secondary: "#111113",
          tertiary: "#18181b",
          card: "#1c1c1f",
          elevated: "#232326",
        },
        // Text colors
        text: {
          primary: "#ffffff",
          secondary: "#a1a1aa",
          tertiary: "#71717a",
          muted: "#52525b",
        },
        // Accent colors
        accent: {
          purple: "#a855f7",
          blue: "#3b82f6",
          yellow: "#eab308",
          orange: "#f97316",
        },
        // Border colors
        border: {
          DEFAULT: "#27272a",
          light: "#3f3f46",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem" }],
        "5xl": ["3rem", { lineHeight: "1" }],
        display: ["4rem", { lineHeight: "1.1" }],
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
        "88": "22rem",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        glow: "0 0 20px rgba(34, 197, 94, 0.3)",
        "glow-red": "0 0 20px rgba(239, 68, 68, 0.3)",
        "glow-lg": "0 0 40px rgba(34, 197, 94, 0.4)",
        card: "0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "bounce-subtle": "bounce-subtle 1s infinite",
        "slide-up": "slide-up 0.3s ease-out",
        "slide-down": "slide-down 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
        shake: "shake 0.5s cubic-bezier(.36,.07,.19,.97) both",
        glow: "glow 2s ease-in-out infinite alternate",
        "number-change": "number-change 0.3s ease-out",
      },
      keyframes: {
        "bounce-subtle": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-down": {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shake: {
          "10%, 90%": { transform: "translateX(-1px)" },
          "20%, 80%": { transform: "translateX(2px)" },
          "30%, 50%, 70%": { transform: "translateX(-4px)" },
          "40%, 60%": { transform: "translateX(4px)" },
        },
        glow: {
          "0%": { boxShadow: "0 0 5px rgba(34, 197, 94, 0.2)" },
          "100%": { boxShadow: "0 0 20px rgba(34, 197, 94, 0.6)" },
        },
        "number-change": {
          "0%": { transform: "scale(1.1)", color: "inherit" },
          "100%": { transform: "scale(1)", color: "inherit" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
