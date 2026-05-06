"use client";

import { useEffect, useState } from "react";
import { UI_CONFIG } from "@/lib/ui-config";

interface GameToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function GameToast({ message, onDismiss }: GameToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (message) {
      setIsVisible(true);
      setIsExiting(false);

      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => {
          setIsVisible(false);
          onDismiss();
        }, UI_CONFIG.toast.fadeOut);
      }, UI_CONFIG.toast.duration);

      return () => clearTimeout(timer);
    }
  }, [message, onDismiss]);

  if (!isVisible || !message) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      style={{
        opacity: isExiting ? 0 : 1,
        transform: `translateX(-50%) translateY(${isExiting ? -10 : 0}px)`,
        transition: `opacity ${UI_CONFIG.toast.fadeOut}ms, transform ${UI_CONFIG.toast.fadeOut}ms`,
      }}
    >
      <div
        className="px-4 py-2 rounded"
        style={{
          backgroundColor: "rgba(40, 20, 50, 0.95)",
          border: `1px solid ${UI_CONFIG.colors.gridLine}`,
          color: UI_CONFIG.colors.textPrimary,
          fontSize: "14px",
          fontFamily: UI_CONFIG.typography.fontFamily,
          fontWeight: 500,
        }}
      >
        {message}
      </div>
    </div>
  );
}
