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
  console[level === "error" ? "error" : "log"](`[toast] ${message}`);

  // Strip the engine's "Trading error: " prefix so the toast reads
  // like the actual reason ("Maximum active bets reached: 3 of 3"
  // instead of "Trading error: Maximum active bets reached: 3 of 3").
  const cleaned = message
    .replace(/^Trading error:\s*/i, "")
    .replace(/^Validation error:\s*/i, "")
    .replace(/^Bad request:\s*/i, "");

  const isError = level === "error";
  const accent = isError ? "#ff5577" : "#00ff88";
  const accentSoft = isError ? "rgba(255,85,119,0.20)" : "rgba(0,255,136,0.18)";
  const icon = isError ? "✕" : "✓";

  const el = document.createElement("div");
  el.setAttribute("role", isError ? "alert" : "status");
  el.style.cssText = [
    "position:fixed",
    "top:96px",
    "right:24px",
    "z-index:9999",
    "max-width:380px",
    "padding:14px 18px",
    "border-radius:10px",
    `border:1px solid ${accent}`,
    `background:${isError ? "#1a0a0e" : "#02110a"}`,
    `box-shadow:0 0 0 1px ${accentSoft}, 0 18px 48px rgba(0,0,0,0.55), 0 0 32px ${accentSoft}`,
    "font-family:ui-monospace,Menlo,monospace",
    "font-size:13px",
    "font-weight:600",
    "color:#ffffff",
    "display:flex",
    "align-items:flex-start",
    "gap:10px",
    "transform:translateX(20px)",
    "opacity:0",
    "transition:transform 0.22s ease-out, opacity 0.22s ease-out",
    "cursor:pointer",
  ].join(";");

  const iconEl = document.createElement("span");
  iconEl.style.cssText = [
    "flex:0 0 auto",
    "width:22px",
    "height:22px",
    "display:grid",
    "place-items:center",
    "border-radius:999px",
    `background:${accent}`,
    `color:${isError ? "#1a0a0e" : "#02110a"}`,
    "font-weight:900",
    "font-size:13px",
  ].join(";");
  iconEl.textContent = icon;

  const textEl = document.createElement("div");
  textEl.style.cssText = "flex:1;line-height:1.4;word-break:break-word";
  textEl.textContent = cleaned;

  el.append(iconEl, textEl);
  document.body.appendChild(el);

  // Animate in next frame so the transform/opacity transition runs.
  requestAnimationFrame(() => {
    el.style.transform = "translateX(0)";
    el.style.opacity = "1";
  });

  const dismiss = () => {
    el.style.opacity = "0";
    el.style.transform = "translateX(20px)";
    setTimeout(() => el.remove(), 240);
  };
  el.addEventListener("click", dismiss);
  // Errors stick around 5 s (you'll want to read them); success
  // confirmations fade after 2.5 s.
  setTimeout(dismiss, isError ? 5_000 : 2_500);
}

const toast: Toast = {
  error: (m: string) => notify("error", m),
  success: (m: string) => notify("success", m),
};

export default toast;
