"use client";

import { useEffect, useRef, useCallback } from "react";

interface VideoPlayerProps {
  vehicleCount: number;
  isLive?: boolean;
  cameraName?: string;
}

interface Vehicle {
  id: number;
  x: number;
  y: number;
  speed: number;
  lane: number;
  width: number;
  height: number;
  color: string;
  type: "car" | "truck" | "van";
  direction: 1 | -1; // 1 = left to right, -1 = right to left
  counted: boolean;
  flash: number; // flash frame counter
}

let vehicleIdCounter = 0;

const VEHICLE_COLORS = [
  "#888", "#aaa", "#ccc", "#777", "#999",
  "#b0b0b0", "#606060", "#d0d0d0",
];

const COUNT_LINE_X_RATIO = 0.38; // counting line position

export default function VideoPlayer({
  vehicleCount,
  isLive = true,
  cameraName = "CAM-04 PEACE-BRIDGE-N",
}: VideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vehiclesRef = useRef<Vehicle[]>([]);
  const frameRef = useRef(0);
  const animRef = useRef<number>(0);
  const prevCountRef = useRef(vehicleCount);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playBeep = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // AudioContext not available (SSR or user hasn't interacted)
    }
  }, []);

  // Play beep when vehicle count increases
  useEffect(() => {
    if (vehicleCount > prevCountRef.current) {
      playBeep();
    }
    prevCountRef.current = vehicleCount;
  }, [vehicleCount, playBeep]);

  function spawnVehicle(canvasWidth: number, canvasHeight: number): Vehicle {
    const type = Math.random() < 0.7 ? "car" : Math.random() < 0.6 ? "van" : "truck";
    const width = type === "truck" ? 28 + Math.random() * 12 : type === "van" ? 20 + Math.random() * 8 : 14 + Math.random() * 8;
    const height = type === "truck" ? 9 : type === "van" ? 8 : 6;
    const direction = Math.random() > 0.45 ? 1 : -1;
    const laneCount = 3;
    const lane = Math.floor(Math.random() * laneCount);
    const laneY = canvasHeight * 0.35 + (lane / (laneCount - 1)) * canvasHeight * 0.32;

    return {
      id: vehicleIdCounter++,
      x: direction === 1 ? -width : canvasWidth + width,
      y: laneY,
      speed: 1.2 + Math.random() * 1.0,
      lane,
      width,
      height,
      color: VEHICLE_COLORS[Math.floor(Math.random() * VEHICLE_COLORS.length)],
      type,
      direction,
      counted: false,
      flash: 0,
    };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastSpawn = 0;
    const SPAWN_INTERVAL = 900; // ms between spawns

    function draw(timestamp: number) {
      if (!canvas || !ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      const COUNT_LINE_X = W * COUNT_LINE_X_RATIO;

      frameRef.current++;

      // Background: very dark night road
      ctx.fillStyle = "#050508";
      ctx.fillRect(0, 0, W, H);

      // Road surface
      const roadTop = H * 0.3;
      const roadBottom = H * 0.82;
      const roadGrad = ctx.createLinearGradient(0, roadTop, 0, roadBottom);
      roadGrad.addColorStop(0, "#0a0a0f");
      roadGrad.addColorStop(0.5, "#111118");
      roadGrad.addColorStop(1, "#0d0d12");
      ctx.fillStyle = roadGrad;
      ctx.fillRect(0, roadTop, W, roadBottom - roadTop);

      // Road edge lines
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, roadTop);
      ctx.lineTo(W, roadTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, roadBottom);
      ctx.lineTo(W, roadBottom);
      ctx.stroke();

      // Lane dividers (dashed)
      ctx.setLineDash([12, 14]);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      const laneTop = roadTop + (roadBottom - roadTop) * 0.33;
      const laneBottom = roadTop + (roadBottom - roadTop) * 0.66;
      ctx.beginPath();
      ctx.moveTo(0, laneTop);
      ctx.lineTo(W, laneTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, laneBottom);
      ctx.lineTo(W, laneBottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distant city lights (horizon)
      for (let i = 0; i < 20; i++) {
        const lx = (i / 20) * W + 10;
        const ly = roadTop - 8 - Math.random() * 15;
        const alpha = 0.1 + Math.random() * 0.15;
        ctx.fillStyle = `rgba(200,220,255,${alpha})`;
        ctx.fillRect(lx, ly, 1 + Math.random() * 2, 3 + Math.random() * 8);
      }

      // Counting line (dashed green)
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "rgba(0,255,136,0.6)";
      ctx.lineWidth = 1.5;
      ctx.shadowColor = "rgba(0,255,136,0.4)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(COUNT_LINE_X, roadTop - 4);
      ctx.lineTo(COUNT_LINE_X, roadBottom + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Count line label
      ctx.fillStyle = "rgba(0,255,136,0.5)";
      ctx.font = "bold 8px monospace";
      ctx.fillText("COUNT LINE", COUNT_LINE_X + 4, roadTop - 8);

      // Spawn new vehicle
      if (timestamp - lastSpawn > SPAWN_INTERVAL && vehiclesRef.current.length < 8) {
        vehiclesRef.current.push(spawnVehicle(W, H));
        lastSpawn = timestamp;
      }

      // Update and draw vehicles
      vehiclesRef.current = vehiclesRef.current.filter((v) => {
        if (v.direction === 1) return v.x < W + v.width + 10;
        return v.x > -v.width - 10;
      });

      for (const v of vehiclesRef.current) {
        v.x += v.speed * v.direction;

        // Check crossing count line
        const prevX = v.x - v.speed * v.direction;
        if (
          !v.counted &&
          ((v.direction === 1 && prevX < COUNT_LINE_X && v.x >= COUNT_LINE_X) ||
            (v.direction === -1 && prevX > COUNT_LINE_X && v.x <= COUNT_LINE_X))
        ) {
          v.counted = true;
          v.flash = 8;
        }

        if (v.flash > 0) v.flash--;

        // Vehicle body
        const vx = v.x - v.width / 2;
        const vy = v.y - v.height / 2;

        ctx.save();

        if (v.flash > 0) {
          ctx.shadowColor = "#00ff88";
          ctx.shadowBlur = 12;
        }

        // Body
        ctx.fillStyle = v.flash > 0 ? "#00ff88" : v.color;
        ctx.fillRect(vx, vy, v.width, v.height);

        // Windshield reflection
        ctx.fillStyle = "rgba(150,200,255,0.2)";
        const wsW = v.width * 0.28;
        const wsX = v.direction === 1 ? vx + v.width - wsW - 2 : vx + 2;
        ctx.fillRect(wsX, vy + 1, wsW, v.height - 2);

        // Headlights / taillights
        if (v.direction === 1) {
          // Headlights (front = right side)
          ctx.fillStyle = "rgba(255,255,200,0.85)";
          ctx.fillRect(vx + v.width - 2, vy + 1, 2, 2);
          ctx.fillRect(vx + v.width - 2, vy + v.height - 3, 2, 2);
          // Taillights
          ctx.fillStyle = "rgba(255,50,50,0.8)";
          ctx.fillRect(vx, vy + 1, 2, 2);
          ctx.fillRect(vx, vy + v.height - 3, 2, 2);
        } else {
          ctx.fillStyle = "rgba(255,255,200,0.85)";
          ctx.fillRect(vx, vy + 1, 2, 2);
          ctx.fillRect(vx, vy + v.height - 3, 2, 2);
          ctx.fillStyle = "rgba(255,50,50,0.8)";
          ctx.fillRect(vx + v.width - 2, vy + 1, 2, 2);
          ctx.fillRect(vx + v.width - 2, vy + v.height - 3, 2, 2);
        }

        ctx.restore();
      }

      // CRT scanlines overlay
      for (let y = 0; y < H; y += 4) {
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(0, y, W, 2);
      }

      // Scanline sweep
      const sweepY = ((frameRef.current * 1.5) % H);
      const sweepGrad = ctx.createLinearGradient(0, sweepY - 8, 0, sweepY + 8);
      sweepGrad.addColorStop(0, "rgba(0,255,136,0)");
      sweepGrad.addColorStop(0.5, "rgba(0,255,136,0.04)");
      sweepGrad.addColorStop(1, "rgba(0,255,136,0)");
      ctx.fillStyle = sweepGrad;
      ctx.fillRect(0, sweepY - 8, W, 16);

      // HUD overlay: vehicle count (top left)
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(8, 8, 90, 44);
      ctx.strokeStyle = "rgba(0,255,136,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(8, 8, 90, 44);

      ctx.fillStyle = "#00ff88";
      ctx.font = "bold 28px monospace";
      ctx.textBaseline = "middle";
      const countStr = String(vehicleCount).padStart(3, "0");
      ctx.fillText(countStr, 18, 30);

      ctx.fillStyle = "rgba(0,255,136,0.5)";
      ctx.font = "7px monospace";
      ctx.textBaseline = "middle";
      ctx.fillText("VEHICLES", 18, 44);

      // HUD: LIVE badge (top right)
      if (isLive) {
        const badgeX = W - 56;
        ctx.fillStyle = "rgba(255,0,0,0.15)";
        ctx.fillRect(badgeX, 10, 48, 18);
        ctx.strokeStyle = "rgba(255,68,68,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(badgeX, 10, 48, 18);

        // Pulsing dot
        const alpha = 0.5 + 0.5 * Math.sin(frameRef.current * 0.12);
        ctx.fillStyle = `rgba(255,68,68,${alpha})`;
        ctx.beginPath();
        ctx.arc(badgeX + 8, 19, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#ff4444";
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "middle";
        ctx.fillText("LIVE", badgeX + 15, 19);
      }

      // Camera name + timestamp (bottom left)
      const now = new Date();
      const timeStr = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const dateStr = now.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      });

      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(6, H - 30, W - 12, 24);

      ctx.fillStyle = "rgba(0,255,136,0.7)";
      ctx.font = "9px monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(cameraName, 12, H - 18);

      ctx.fillStyle = "rgba(200,200,200,0.6)";
      ctx.textAlign = "right";
      ctx.fillText(`${dateStr}  ${timeStr}`, W - 12, H - 18);
      ctx.textAlign = "left";

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [vehicleCount, isLive, cameraName]);

  return (
    <div
      className="relative w-full"
      style={{
        aspectRatio: "16/9",
        background: "#000",
        borderRadius: "4px",
        overflow: "hidden",
        border: "1px solid #1a1a1a",
      }}
    >
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        style={{ width: "100%", height: "100%", display: "block" }}
        aria-label="Live CCTV feed — Peace Bridge vehicle counter"
      />
    </div>
  );
}
