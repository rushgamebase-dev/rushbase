"use client";

import { useEffect, useRef, useCallback } from "react";

// =============================================================================
// PARTICLE SYSTEM - High-Performance Canvas-Based Particle Engine
// =============================================================================

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  rotation: number;
  rotationSpeed: number;
  life: number;
  maxLife: number;
  type: 'circle' | 'square' | 'star' | 'spark' | 'coin';
}

interface ParticleEmission {
  x: number;
  y: number;
  count: number;
  colors: string[];
  speed: number;
  spread: number;
  gravity: number;
  size: number;
  duration: number;
  type?: Particle['type'];
}

export interface ParticleSystemRef {
  emit: (config: ParticleEmission) => void;
  emitWin: (x: number, y: number, amount: number) => void;
  emitLoss: (x: number, y: number) => void;
  emitBigWin: (x: number, y: number) => void;
  emitStreak: (x: number, y: number, streak: number) => void;
  emitLevelUp: () => void;
  emitConfetti: () => void;
  clear: () => void;
}

const WIN_COLORS = ['#4ade80', '#22c55e', '#86efac', '#fbbf24', '#f59e0b'];
const LOSS_COLORS = ['#f87171', '#ef4444', '#fca5a5'];
const BIG_WIN_COLORS = ['#fbbf24', '#f59e0b', '#fcd34d', '#4ade80', '#22c55e', '#a855f7', '#c084fc'];
const STREAK_COLORS = ['#f97316', '#fb923c', '#fdba74', '#fbbf24', '#f59e0b'];
const LEVEL_UP_COLORS = ['#a855f7', '#c084fc', '#e879f9', '#22d3ee', '#67e8f9', '#fbbf24'];
const CONFETTI_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];

export function ParticleSystem({
  className = "",
  onRef,
}: {
  className?: string;
  onRef?: (ref: ParticleSystemRef) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);

  const emit = useCallback((config: ParticleEmission) => {
    const particles = particlesRef.current;
    const { x, y, count, colors, speed, spread, gravity, size, duration, type = 'circle' } = config;

    for (let i = 0; i < count; i++) {
      const angle = (Math.random() - 0.5) * spread * Math.PI;
      const velocity = speed * (0.5 + Math.random() * 0.5);

      particles.push({
        x,
        y,
        vx: Math.sin(angle) * velocity,
        vy: -Math.cos(angle) * velocity - (Math.random() * speed * 0.3),
        size: size * (0.5 + Math.random() * 0.5),
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.2,
        life: 0,
        maxLife: duration * (0.7 + Math.random() * 0.3),
        type,
      });
    }
  }, []);

  const emitWin = useCallback((x: number, y: number, amount: number) => {
    const intensity = Math.min(1 + amount / 50, 3);
    emit({
      x, y,
      count: Math.floor(20 * intensity),
      colors: WIN_COLORS,
      speed: 8 * intensity,
      spread: 1.5,
      gravity: 0.15,
      size: 6,
      duration: 1200,
      type: 'star',
    });
  }, [emit]);

  const emitLoss = useCallback((x: number, y: number) => {
    emit({
      x, y,
      count: 10,
      colors: LOSS_COLORS,
      speed: 4,
      spread: 2,
      gravity: 0.3,
      size: 4,
      duration: 800,
      type: 'spark',
    });
  }, [emit]);

  const emitBigWin = useCallback((x: number, y: number) => {
    // Multiple bursts
    for (let burst = 0; burst < 3; burst++) {
      setTimeout(() => {
        emit({
          x: x + (Math.random() - 0.5) * 50,
          y: y + (Math.random() - 0.5) * 50,
          count: 40,
          colors: BIG_WIN_COLORS,
          speed: 12,
          spread: 2,
          gravity: 0.1,
          size: 8,
          duration: 1500,
          type: 'star',
        });
      }, burst * 100);
    }

    // Coin shower
    emit({
      x, y,
      count: 15,
      colors: ['#fbbf24', '#f59e0b', '#fcd34d'],
      speed: 6,
      spread: 1,
      gravity: 0.2,
      size: 10,
      duration: 2000,
      type: 'coin',
    });
  }, [emit]);

  const emitStreak = useCallback((x: number, y: number, streak: number) => {
    const intensity = Math.min(1 + streak / 3, 3);
    emit({
      x, y,
      count: Math.floor(15 * intensity),
      colors: STREAK_COLORS,
      speed: 10 * intensity,
      spread: 0.8,
      gravity: 0.05,
      size: 5,
      duration: 1000,
      type: 'spark',
    });

    // Fire trail effect
    for (let i = 0; i < streak; i++) {
      setTimeout(() => {
        emit({
          x: x + (Math.random() - 0.5) * 30,
          y: y - 20 - i * 10,
          count: 5,
          colors: STREAK_COLORS,
          speed: 3,
          spread: 0.5,
          gravity: -0.1, // Float up
          size: 4,
          duration: 600,
          type: 'circle',
        });
      }, i * 50);
    }
  }, [emit]);

  const emitLevelUp = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Radial burst
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
      emit({
        x: cx + Math.cos(angle) * 50,
        y: cy + Math.sin(angle) * 50,
        count: 5,
        colors: LEVEL_UP_COLORS,
        speed: 15,
        spread: 0.3,
        gravity: 0,
        size: 8,
        duration: 1500,
        type: 'star',
      });
    }

    // Central explosion
    emit({
      x: cx, y: cy,
      count: 60,
      colors: LEVEL_UP_COLORS,
      speed: 20,
      spread: 2,
      gravity: 0.05,
      size: 6,
      duration: 2000,
      type: 'circle',
    });
  }, [emit]);

  const emitConfetti = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Rain confetti from top
    for (let i = 0; i < 100; i++) {
      setTimeout(() => {
        emit({
          x: Math.random() * canvas.width,
          y: -10,
          count: 1,
          colors: CONFETTI_COLORS,
          speed: 2,
          spread: 0.5,
          gravity: 0.08,
          size: 8,
          duration: 3000,
          type: 'square',
        });
      }, i * 30);
    }
  }, [emit]);

  const clear = useCallback(() => {
    particlesRef.current = [];
  }, []);

  // Expose methods via ref callback
  useEffect(() => {
    if (onRef) {
      onRef({ emit, emitWin, emitLoss, emitBigWin, emitStreak, emitLevelUp, emitConfetti, clear });
    }
  }, [onRef, emit, emitWin, emitLoss, emitBigWin, emitStreak, emitLevelUp, emitConfetti, clear]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const drawStar = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const outerX = Math.cos(angle) * size;
        const outerY = Math.sin(angle) * size;
        const innerAngle = angle + Math.PI / 5;
        const innerX = Math.cos(innerAngle) * size * 0.4;
        const innerY = Math.sin(innerAngle) * size * 0.4;
        if (i === 0) {
          ctx.moveTo(outerX, outerY);
        } else {
          ctx.lineTo(outerX, outerY);
        }
        ctx.lineTo(innerX, innerY);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawCoin = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number) => {
      ctx.save();
      ctx.translate(x, y);
      const scaleX = Math.abs(Math.cos(rotation * 2));
      ctx.scale(scaleX, 1);
      ctx.beginPath();
      ctx.arc(0, 0, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    };

    let lastTime = performance.now();

    const animate = (time: number) => {
      const dt = Math.min((time - lastTime) / 16.67, 3); // Cap delta time
      lastTime = time;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Update
        p.life += dt * 16.67;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.5 * dt; // Base gravity
        p.rotation += p.rotationSpeed * dt;

        const lifeRatio = p.life / p.maxLife;
        p.alpha = 1 - lifeRatio;

        // Remove dead particles
        if (p.life >= p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        // Draw
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;

        switch (p.type) {
          case 'star':
            drawStar(ctx, p.x, p.y, p.size, p.rotation);
            break;
          case 'coin':
            drawCoin(ctx, p.x, p.y, p.size, p.rotation);
            break;
          case 'spark':
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, p.size * 1.5, p.size * 0.5, p.rotation, 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'square':
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            ctx.restore();
            break;
          default:
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }

        // Glow effect for bright particles
        if (p.alpha > 0.5) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = p.size * 2;
        }

        ctx.restore();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`fixed inset-0 pointer-events-none z-40 ${className}`}
    />
  );
}
