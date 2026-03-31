"use client";

import { useState, useEffect, useRef } from "react";

interface CountdownTimerProps {
  endDate: Date;
  onExpired?: () => void;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function computeTimeLeft(endDate: Date): TimeLeft {
  const diff = endDate.getTime() - Date.now();
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, expired: false };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function CountdownTimer({ endDate, onExpired }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => computeTimeLeft(endDate));
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    const tick = () => {
      const next = computeTimeLeft(endDate);
      setTimeLeft(next);
      if (next.expired && onExpiredRef.current) {
        onExpiredRef.current();
      }
    };

    tick(); // immediate sync on mount
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endDate]);

  if (timeLeft.expired) {
    return (
      <span
        className="text-xs font-bold tracking-widest tabular"
        style={{ color: "var(--muted)", fontFamily: "monospace" }}
        aria-label="Market ended"
      >
        ENDED
      </span>
    );
  }

  const totalMs = endDate.getTime() - Date.now();
  const isUnderOneHour = totalMs < 3600000;
  const isUnderFiveMinutes = totalMs < 300000;

  const color = isUnderOneHour ? "var(--danger)" : "var(--text)";

  let display = "";
  if (timeLeft.days > 0) {
    display = `${timeLeft.days}d ${pad(timeLeft.hours)}h ${pad(timeLeft.minutes)}m ${pad(timeLeft.seconds)}s`;
  } else if (timeLeft.hours > 0) {
    display = `${pad(timeLeft.hours)}h ${pad(timeLeft.minutes)}m ${pad(timeLeft.seconds)}s`;
  } else {
    display = `${pad(timeLeft.minutes)}m ${pad(timeLeft.seconds)}s`;
  }

  return (
    <span
      className={`text-xs font-bold tabular ${isUnderFiveMinutes ? "animate-pulse" : ""}`}
      style={{
        color,
        fontFamily: "monospace",
        textShadow: isUnderOneHour ? "0 0 6px rgba(255,68,68,0.5)" : "none",
      }}
      aria-label={`Time remaining: ${display}`}
      aria-live="off"
    >
      {display}
    </span>
  );
}
