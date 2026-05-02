"use client";

/**
 * Minimal toast shim. The standalone repo pulled `react-hot-toast`;
 * here we wire the same surface (`toast.error`, `toast.success`) to
 * a console-mirrored notification so the trade page keeps working
 * without a new dep.
 *
 * Replace with a real toast renderer if/when the rest of the Rush
 * frontend adopts one.
 */

type ToastFn = (message: string) => void;

interface Toast {
  error: ToastFn;
  success: ToastFn;
}

function notify(level: "error" | "success", message: string) {
  if (typeof window === "undefined") {
    // SSR: only console — never a side effect on render.
    if (level === "error") console.error(`[toast] ${message}`);
    else console.log(`[toast] ${message}`);
    return;
  }
  // Quick-and-clean: log to console for devtools, fire a transient
  // DOM banner that fades. Keep it tiny — no dep, no portal.
  console[level === "error" ? "error" : "log"](`[toast] ${message}`);
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:9999",
    "padding:10px 16px",
    "border-radius:8px",
    "font-family:ui-monospace,Menlo,monospace",
    "font-size:13px",
    "color:#0a0a0a",
    `background:${level === "error" ? "#ff5577" : "#00ff88"}`,
    "box-shadow:0 4px 16px rgba(0,0,0,0.4)",
    "transition:opacity 0.3s",
  ].join(";");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3_000);
}

const toast: Toast = {
  error: (m: string) => notify("error", m),
  success: (m: string) => notify("success", m),
};

export default toast;
