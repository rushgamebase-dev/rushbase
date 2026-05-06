"use client";

import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import { useBalance, usePrices, useGamification } from "@/stores";
import { useWebSocketTrading } from "@/hooks/use-websocket-trading";
import { useHaptic } from "@/hooks/use-haptic";
import { useScreenShake } from "@/hooks/use-screen-shake";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Wallet,
  Settings,
  TrendingUp,
  TrendingDown,
  Zap,
  Trophy,
  Target,
  Info,
  X,
  Flame,
  Star,
  RotateCcw,
} from "lucide-react";

import {
  ParticleSystem,
  ParticleSystemRef,
  AnimatedNumber,
  AnimatedWinRate,
  StreakDisplay,
  StreakPopup,
  LevelDisplay,
  LevelUpPopup,
  getLevelFromXP,
  StakeSelector,
  SoundManagerProvider,
  useSoundManager,
  SoundToggle,
  QuickStats,
  MiniLeaderboard,
  AchievementUnlockPopup,
} from "@/components/gamification";
import { Achievement, ACHIEVEMENTS, calculateTradeXP, getStreakMultiplier } from "@/types/gamification";

// =============================================================================
// CONFIGURATION
// =============================================================================
const CONFIG = {
  colors: {
    bg: "#0d0a12",
    bgGradient: "linear-gradient(135deg, #0d0a12 0%, #1a0f24 50%, #0d0a12 100%)",
    gridLine: "rgba(139, 92, 246, 0.2)",
    gridLineHighlight: "rgba(139, 92, 246, 0.4)",
    chartLine: "#ec4899",
    chartGlow: "rgba(236, 72, 153, 0.6)",
    tileActive: "#cddc39",
    tileBorder: "#afb42b",
    tileLost: "#ff5722",
    tileLostBorder: "#e64a19",
    tileWon: "#4caf50",
    tileWonBorder: "#388e3c",
    textPrimary: "#ffffff",
    textMuted: "rgba(255, 255, 255, 0.5)",
    textDark: "#1a1a1a",
    priceTag: "#ec4899",
    positive: "#4caf50",
    negative: "#f44336",
    neon: {
      purple: "#a855f7",
      pink: "#ec4899",
      cyan: "#22d3ee",
      yellow: "#fbbf24",
    }
  },
  msPerColumn: 3000,
  priceStepPercent: 0.02,
};

// Responsive grid config
function getGridConfig(isMobile: boolean) {
  return isMobile ? {
    cellWidth: 38,
    cellHeight: 32,
    rows: 9,
    visibleCols: 9,
    priceAxisWidth: 55,
  } : {
    cellWidth: 52,
    cellHeight: 40,
    rows: 11,
    visibleCols: 13,
    priceAxisWidth: 75,
  };
}

// =============================================================================
// TYPES
// =============================================================================
interface Position {
  id: string;
  row: number;
  targetCol: number;
  entryPrice: number;
  targetPrice: number;
  stake: number;
  multiplier: number;
  potentialPayout: number;
  status: "active" | "won" | "lost";
  direction: "up" | "down";
  entryTime: number;
  resolveTime: number;
}

interface GameStats {
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  netPnL: number;
  biggestWin: number;
  biggestLoss: number;
  sessionXP: number;
  totalXP: number;
}

interface ResultAnimation {
  id: string;
  row: number;
  col: number;
  amount: number;
  isWin: boolean;
  startTime: number;
  duration: number;
  screenX?: number;
  screenY?: number;
}

// =============================================================================
// MULTIPLIER CALCULATION
// =============================================================================
function calculateMultiplier(
  rowDistance: number,
  colDistance: number,
  totalRows: number
): number {
  const priceRisk = Math.abs(rowDistance) / (totalRows / 2);
  const timeFactor = 1 + (colDistance * 0.05);
  const baseMultiplier = 1.1 + (priceRisk * priceRisk * 8);
  const finalMultiplier = baseMultiplier * timeFactor;
  return Math.round(finalMultiplier * 100) / 100;
}

// =============================================================================
// INNER COMPONENT (with sound manager context)
// =============================================================================
function TradePageInner() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const priceHistoryRef = useRef<number[]>([]);
  const positionsRef = useRef<Position[]>([]);
  const resultAnimationsRef = useRef<ResultAnimation[]>([]);
  const particleSystemRef = useRef<ParticleSystemRef | null>(null);
  const sessionStartRef = useRef<number>(Date.now());

  const { balance, fetchBalance } = useBalance();
  const { prices } = usePrices();
  const { isConnected } = useWebSocketTrading();
  const { hapticTap, hapticSuccess, hapticError } = useHaptic();
  const { style: shakeStyle, shakeWin, shakeBigWin, shakeLoss, shakeBigLoss, shakeStreak } = useScreenShake();
  const { playSound } = useSoundManager();
  const { recordWin, recordLoss, currentStreak, maxStreak, incrementStreak, resetStreak } = useGamification();

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Responsive grid config
  const gridConfig = useMemo(() => getGridConfig(isMobile), [isMobile]);

  // Game state
  const [positions, setPositions] = useState<Position[]>([]);
  const [stakeAmount, setStakeAmount] = useState(5);
  const [showStakePanel, setShowStakePanel] = useState(false);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [stats, setStats] = useState<GameStats>({
    totalBets: 0, totalWins: 0, totalLosses: 0, netPnL: 0,
    biggestWin: 0, biggestLoss: 0, sessionXP: 0, totalXP: 500,
  });
  const [localBalance, setLocalBalance] = useState(10000);
  const [showTutorial, setShowTutorial] = useState(true);
  const [showStreakPopup, setShowStreakPopup] = useState(false);
  const [popupStreak, setPopupStreak] = useState(0);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [newLevel, setNewLevel] = useState(1);
  const [unlockedAchievement, setUnlockedAchievement] = useState<Achievement | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>(ACHIEVEMENTS.map(a => ({ ...a })));
  const [localStreak, setLocalStreak] = useState(0);

  // Derived values
  const priceStep = useMemo(() => currentPrice * CONFIG.priceStepPercent / 100, [currentPrice]);
  const centerRow = Math.floor(gridConfig.rows / 2);
  const levelData = getLevelFromXP(stats.totalXP);

  const priceLevels = useMemo(() => {
    if (!currentPrice) return [];
    return Array.from({ length: gridConfig.rows }, (_, i) => {
      const rowOffset = centerRow - i;
      return currentPrice + (rowOffset * priceStep);
    });
  }, [currentPrice, priceStep, centerRow]);

  const getCurrentCol = useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current;
    return elapsed / CONFIG.msPerColumn;
  }, []);

  const getPriceRow = useCallback((price: number): number => {
    if (!currentPrice || !priceStep) return centerRow;
    const rowOffset = (price - currentPrice) / priceStep;
    return Math.round(centerRow - rowOffset);
  }, [currentPrice, priceStep, centerRow]);

  // Check and unlock achievements
  const checkAchievements = useCallback((newStats: GameStats, newStreak: number, winAmount?: number) => {
    setAchievements(prev => {
      const updated = [...prev];
      let unlocked: Achievement | null = null;

      // Check each achievement
      updated.forEach(a => {
        if (a.unlocked) return;

        let shouldUnlock = false;

        switch (a.id) {
          case 'first_win':
            shouldUnlock = newStats.totalWins >= 1;
            break;
          case 'streak_3':
            shouldUnlock = newStreak >= 3;
            break;
          case 'streak_5':
            shouldUnlock = newStreak >= 5;
            break;
          case 'streak_10':
            shouldUnlock = newStreak >= 10;
            break;
          case 'wins_10':
            shouldUnlock = newStats.totalWins >= 10;
            a.progress = Math.min(newStats.totalWins, 10);
            a.maxProgress = 10;
            break;
          case 'wins_50':
            shouldUnlock = newStats.totalWins >= 50;
            a.progress = Math.min(newStats.totalWins, 50);
            a.maxProgress = 50;
            break;
          case 'wins_100':
            shouldUnlock = newStats.totalWins >= 100;
            a.progress = Math.min(newStats.totalWins, 100);
            a.maxProgress = 100;
            break;
          case 'big_win':
            shouldUnlock = winAmount !== undefined && winAmount >= 100;
            break;
          case 'huge_win':
            shouldUnlock = winAmount !== undefined && winAmount >= 500;
            break;
        }

        if (shouldUnlock) {
          a.unlocked = true;
          a.unlockedAt = Date.now();
          unlocked = a;
        }
      });

      if (unlocked) {
        setUnlockedAchievement(unlocked);
        playSound('achievement');
        // Add XP from achievement
        setStats(s => ({ ...s, totalXP: s.totalXP + unlocked!.xpReward, sessionXP: s.sessionXP + unlocked!.xpReward }));
      }

      return updated;
    });
  }, [playSound]);

  // Initialize with real price
  useEffect(() => {
    const realPrice = prices["ETHUSDT"] || prices["BTCUSDT"] || 2995;
    if (realPrice && realPrice !== currentPrice) {
      setCurrentPrice(realPrice);

      if (priceHistoryRef.current.length === 0) {
        const history: number[] = [];
        let p = realPrice;
        for (let i = 0; i < 500; i++) {
          p += (Math.random() - 0.5) * (realPrice * 0.0003);
          history.push(p);
        }
        priceHistoryRef.current = history;
      }
    }
  }, [prices, currentPrice]);

  // Real balance sync
  useEffect(() => {
    if (balance.availableBalance > 0) {
      setLocalBalance(balance.availableBalance);
    }
  }, [balance.availableBalance]);

  // Sync positions ref
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  // Dismiss tutorial after first bet
  useEffect(() => {
    if (stats.totalBets > 0 && showTutorial) {
      setShowTutorial(false);
    }
  }, [stats.totalBets, showTutorial]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPrice) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastUpdate = Date.now();

    const gameLoop = () => {
      const now = Date.now();
      const currentCol = getCurrentCol();
      const priceHistory = priceHistoryRef.current;

      // Update price
      if (now - lastUpdate > 16 && priceHistory.length >= 2) {
        lastUpdate = now;
        const last = priceHistory[priceHistory.length - 1];
        const secondLast = priceHistory[priceHistory.length - 2];
        const momentum = (last - secondLast) * 0.4;
        const noise = (Math.random() - 0.5) * (currentPrice * 0.00025);
        const drift = (currentPrice - last) * 0.02;
        const newPrice = last + momentum + noise + drift;
        priceHistoryRef.current = [...priceHistory.slice(-600), newPrice];
      }

      // Resolve positions
      const currentPositions = positionsRef.current;
      let hasChanges = false;
      let balanceChange = 0;
      let pnlChange = 0;
      let newWins = 0;
      let newLosses = 0;
      const newAnimations: ResultAnimation[] = [];
      let biggestWinThisFrame = 0;
      let biggestLossThisFrame = 0;
      let xpGained = 0;

      const updatedPositions = currentPositions.map(pos => {
        if (pos.status !== "active") return pos;

        if (currentCol >= pos.targetCol) {
          hasChanges = true;
          const latestPrice = priceHistoryRef.current[priceHistoryRef.current.length - 1] || currentPrice;
          const priceRow = getPriceRow(latestPrice);

          const won = pos.direction === "up"
            ? priceRow <= pos.row
            : priceRow >= pos.row;

          // Calculate screen position for particles
          const rect = canvas.getBoundingClientRect();
          const colOffset = pos.targetCol - currentCol;
          const nowX = gridConfig.visibleCols * gridConfig.cellWidth * 0.2;
          const tileX = nowX + (colOffset * gridConfig.cellWidth);
          const tileY = pos.row * gridConfig.cellHeight + gridConfig.cellHeight / 2;

          const screenX = rect.left + (tileX / canvas.width) * rect.width;
          const screenY = rect.top + (tileY / canvas.height) * rect.height;

          newAnimations.push({
            id: `anim-${pos.id}`,
            row: pos.row,
            col: pos.targetCol,
            amount: won ? pos.potentialPayout : pos.stake,
            isWin: won,
            startTime: now,
            duration: 1500,
            screenX,
            screenY,
          });

          if (won) {
            const profit = pos.potentialPayout - pos.stake;
            balanceChange += pos.potentialPayout;
            newWins++;
            pnlChange += profit;
            biggestWinThisFrame = Math.max(biggestWinThisFrame, profit);
            return { ...pos, status: "won" as const };
          } else {
            newLosses++;
            pnlChange -= pos.stake;
            biggestLossThisFrame = Math.max(biggestLossThisFrame, pos.stake);
            return { ...pos, status: "lost" as const };
          }
        }
        return pos;
      }).filter(pos => {
        if (pos.status === "active") return true;
        return currentCol - pos.targetCol < 3;
      });

      // Handle win/loss effects
      if (newWins > 0) {
        const newStreak = localStreak + newWins;
        setLocalStreak(newStreak);

        newAnimations.forEach(anim => {
          if (anim.isWin && particleSystemRef.current && anim.screenX && anim.screenY) {
            if (biggestWinThisFrame >= 50) {
              particleSystemRef.current.emitBigWin(anim.screenX, anim.screenY);
              shakeBigWin();
              playSound('bigWin');
            } else {
              particleSystemRef.current.emitWin(anim.screenX, anim.screenY, anim.amount);
              shakeWin();
              playSound('win');
            }
          }
        });

        hapticSuccess();
        recordWin();

        // Check for streak milestones
        if ([3, 5, 10, 15, 20].includes(newStreak)) {
          setPopupStreak(newStreak);
          setShowStreakPopup(true);
          shakeStreak();
          playSound('streak');

          if (particleSystemRef.current) {
            particleSystemRef.current.emitStreak(window.innerWidth / 2, window.innerHeight / 2, newStreak);
          }

          setTimeout(() => setShowStreakPopup(false), 2000);
        }

        // Calculate XP
        const xp = calculateTradeXP(true, stakeAmount, 2, newStreak);
        xpGained += xp;

        // Check achievements
        setTimeout(() => {
          checkAchievements(
            { ...stats, totalWins: stats.totalWins + newWins },
            newStreak,
            biggestWinThisFrame
          );
        }, 100);
      }

      if (newLosses > 0) {
        setLocalStreak(0);

        newAnimations.forEach(anim => {
          if (!anim.isWin && particleSystemRef.current && anim.screenX && anim.screenY) {
            particleSystemRef.current.emitLoss(anim.screenX, anim.screenY);
          }
        });

        if (biggestLossThisFrame >= 50) {
          shakeBigLoss();
        } else {
          shakeLoss();
        }

        hapticError();
        playSound('loss');
        recordLoss();
        resetStreak();

        // XP for losses too (small amount)
        xpGained += 5 * newLosses;
      }

      // Add new animations
      if (newAnimations.length > 0) {
        resultAnimationsRef.current = [...resultAnimationsRef.current, ...newAnimations];
      }

      // Clean up expired animations
      resultAnimationsRef.current = resultAnimationsRef.current.filter(
        anim => now - anim.startTime < anim.duration
      );

      if (hasChanges) {
        setPositions(updatedPositions);
        if (balanceChange !== 0) setLocalBalance(b => b + balanceChange);

        // Check for level up before updating stats
        const oldLevel = getLevelFromXP(stats.totalXP).level;

        setStats(s => {
          const newStats = {
            ...s,
            totalWins: s.totalWins + newWins,
            totalLosses: s.totalLosses + newLosses,
            netPnL: s.netPnL + pnlChange,
            biggestWin: Math.max(s.biggestWin, biggestWinThisFrame),
            biggestLoss: Math.max(s.biggestLoss, biggestLossThisFrame),
            sessionXP: s.sessionXP + xpGained,
            totalXP: s.totalXP + xpGained,
          };

          // Check for level up
          const newLevelData = getLevelFromXP(newStats.totalXP);
          if (newLevelData.level > oldLevel) {
            setNewLevel(newLevelData.level);
            setShowLevelUp(true);
            playSound('levelUp');
            if (particleSystemRef.current) {
              particleSystemRef.current.emitLevelUp();
            }
            setTimeout(() => setShowLevelUp(false), 3000);
          }

          return newStats;
        });
      }

      // === RENDER ===
      const { cellWidth, cellHeight, rows, visibleCols } = gridConfig;
      const gridWidth = visibleCols * cellWidth;
      const gridHeight = rows * cellHeight;
      const nowX = gridWidth * 0.2;
      const subPixelOffset = (currentCol % 1) * cellWidth;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Background gradient
      const bgGradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      bgGradient.addColorStop(0, '#0d0a12');
      bgGradient.addColorStop(0.5, '#1a0f24');
      bgGradient.addColorStop(1, '#0d0a12');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid lines with glow
      ctx.lineWidth = 1;
      for (let i = 0; i <= rows; i++) {
        const y = i * cellHeight;
        const isCenter = i === centerRow || i === centerRow + 1;

        if (isCenter) {
          ctx.shadowColor = CONFIG.colors.neon.purple;
          ctx.shadowBlur = 8;
          ctx.strokeStyle = CONFIG.colors.gridLineHighlight;
        } else {
          ctx.shadowBlur = 0;
          ctx.strokeStyle = CONFIG.colors.gridLine;
        }

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(gridWidth, y);
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.strokeStyle = CONFIG.colors.gridLine;
      for (let i = -1; i <= visibleCols + 1; i++) {
        const x = nowX + (i * cellWidth) - subPixelOffset;
        if (x >= 0 && x <= gridWidth) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, gridHeight);
          ctx.stroke();
        }
      }

      // Draw multipliers with gradient text
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (let row = 0; row < rows; row++) {
        for (let visCol = 0; visCol <= visibleCols; visCol++) {
          const x = nowX + (visCol * cellWidth) - subPixelOffset + cellWidth / 2;
          const y = row * cellHeight + cellHeight / 2;
          if (x > nowX && x < gridWidth - 10) {
            const mult = calculateMultiplier(row - centerRow, visCol, rows);
            const intensity = Math.min(mult / 5, 1);

            // Color based on multiplier
            const r = Math.floor(139 + intensity * 100);
            const g = Math.floor(92 - intensity * 50);
            const b = Math.floor(246);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + intensity * 0.3})`;
            ctx.font = `${10 + intensity * 2}px Inter, system-ui, sans-serif`;
            ctx.fillText(`${mult.toFixed(2)}x`, x, y);
          }
        }
      }

      // Draw price line with enhanced glow
      const historyToShow = priceHistoryRef.current.slice(-400);
      if (historyToShow.length > 10) {
        const getY = (price: number) => {
          const row = getPriceRow(price);
          return Math.max(0, Math.min(gridHeight, row * cellHeight + cellHeight / 2));
        };

        // Gradient fill under the line
        ctx.beginPath();
        ctx.moveTo(0, gridHeight);
        historyToShow.forEach((price, i) => {
          ctx.lineTo((i / historyToShow.length) * nowX, getY(price));
        });
        ctx.lineTo(nowX, gridHeight);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, gridHeight);
        gradient.addColorStop(0, "rgba(236, 72, 153, 0.2)");
        gradient.addColorStop(0.5, "rgba(236, 72, 153, 0.1)");
        gradient.addColorStop(1, "rgba(236, 72, 153, 0)");
        ctx.fillStyle = gradient;
        ctx.fill();

        // Line with neon glow
        ctx.shadowColor = CONFIG.colors.chartGlow;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.strokeStyle = CONFIG.colors.chartLine;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        historyToShow.forEach((price, i) => {
          const x = (i / historyToShow.length) * nowX;
          const y = getY(price);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Current price dot with pulsing effect
        const lastPrice = historyToShow[historyToShow.length - 1];
        const dotY = getY(lastPrice);
        const pulse = 1 + Math.sin(Date.now() / 100) * 0.4;

        // Outer glow
        ctx.beginPath();
        ctx.arc(nowX, dotY, 15 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(236, 72, 153, 0.15)";
        ctx.fill();

        // Middle ring
        ctx.beginPath();
        ctx.arc(nowX, dotY, 10 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
        ctx.fill();

        // Inner dot
        ctx.beginPath();
        ctx.arc(nowX, dotY, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw "Now" line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(nowX, 0);
      ctx.lineTo(nowX, gridHeight);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw tiles with enhanced effects
      updatedPositions.forEach(pos => {
        const colOffset = pos.targetCol - currentCol;
        const tileX = nowX + (colOffset * cellWidth);
        const tileY = pos.row * cellHeight;

        if (tileX > 0 && tileX < gridWidth) {
          const pad = 3;
          const tw = cellWidth - pad * 2;
          const th = cellHeight - pad * 2;

          let bgColor = CONFIG.colors.tileActive;
          let borderColor = CONFIG.colors.tileBorder;
          let glowColor = "rgba(205, 220, 57, 0.6)";

          const activeAnim = resultAnimationsRef.current.find(a => a.id === `anim-${pos.id}`);
          const animProgress = activeAnim ? (now - activeAnim.startTime) / activeAnim.duration : 1;
          const isAnimating = animProgress < 1;

          if (pos.status === "won") {
            bgColor = CONFIG.colors.tileWon;
            borderColor = CONFIG.colors.tileWonBorder;
            glowColor = "#4caf50";
          } else if (pos.status === "lost") {
            bgColor = CONFIG.colors.tileLost;
            borderColor = CONFIG.colors.tileLostBorder;
            glowColor = "#ff5722";
          }

          ctx.save();

          // Animation effects
          if (isAnimating) {
            const pulse = 1 + Math.sin(animProgress * Math.PI * 4) * 0.15 * (1 - animProgress);
            const centerX = tileX + cellWidth / 2;
            const centerY = tileY + cellHeight / 2;

            ctx.translate(centerX, centerY);
            ctx.scale(pulse, pulse);
            ctx.translate(-centerX, -centerY);

            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 30 * (1 - animProgress);
          } else if (pos.status === "active") {
            // Active tile glow
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 12 + Math.sin(Date.now() / 200) * 4;
          }

          // Draw tile background
          ctx.fillStyle = bgColor;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(tileX + pad, tileY + pad, tw, th, 6);
          } else {
            ctx.rect(tileX + pad, tileY + pad, tw, th);
          }
          ctx.fill();

          // Draw border
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = isAnimating ? 3 : 2;
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Tile content
          const isUp = pos.direction === "up";
          ctx.fillStyle = CONFIG.colors.textDark;
          ctx.font = "bold 11px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`$${pos.stake}`, tileX + cellWidth / 2, tileY + cellHeight / 2 - 6);

          ctx.font = "9px Inter, system-ui, sans-serif";
          ctx.fillStyle = pos.status === "active" ? "#333" : (pos.status === "won" ? "#1b5e20" : "#b71c1c");
          ctx.fillText(`${pos.multiplier.toFixed(2)}x ${isUp ? "\u25B2" : "\u25BC"}`, tileX + cellWidth / 2, tileY + cellHeight / 2 + 8);

          ctx.restore();
        }
      });

      // Draw result animations
      resultAnimationsRef.current.forEach(anim => {
        const elapsed = now - anim.startTime;
        const progress = elapsed / anim.duration;

        if (progress >= 1) return;

        const easeOut = 1 - Math.pow(1 - progress, 3);

        const colOffset = anim.col - currentCol;
        const baseX = nowX + (colOffset * cellWidth) + cellWidth / 2;
        const baseY = anim.row * cellHeight + cellHeight / 2;

        const floatY = baseY - (easeOut * 80);
        const opacity = 1 - easeOut;
        const scale = 1 + (easeOut * 0.8);

        // Enhanced glow
        ctx.save();
        ctx.globalAlpha = opacity * 0.6;
        ctx.shadowColor = anim.isWin ? "#4caf50" : "#f44336";
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(baseX, floatY, 30 * scale, 0, Math.PI * 2);
        ctx.fillStyle = anim.isWin ? "rgba(76, 175, 80, 0.4)" : "rgba(244, 67, 54, 0.4)";
        ctx.fill();
        ctx.restore();

        // Text with outline
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.font = `bold ${16 * scale}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const text = anim.isWin
          ? `+$${anim.amount.toFixed(2)}`
          : `-$${anim.amount.toFixed(2)}`;

        // Outline
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 4;
        ctx.strokeText(text, baseX, floatY);

        // Fill
        ctx.fillStyle = anim.isWin ? "#4caf50" : "#f44336";
        ctx.shadowColor = anim.isWin ? "#4caf50" : "#f44336";
        ctx.shadowBlur = 15;
        ctx.fillText(text, baseX, floatY);

        // Win particles
        if (anim.isWin && progress < 0.7) {
          const particleCount = 10;
          for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2 + (elapsed * 0.004);
            const dist = 20 + (easeOut * 50);
            const px = baseX + Math.cos(angle) * dist;
            const py = floatY + Math.sin(angle) * dist;
            const particleSize = 3 * (1 - progress);

            ctx.beginPath();
            ctx.arc(px, py, particleSize, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(205, 220, 57, ${opacity})`;
            ctx.fill();
          }
        }

        ctx.restore();
      });

      // Price axis
      priceLevels.forEach((price, i) => {
        const y = i * cellHeight + cellHeight / 2;
        const isCenter = i === centerRow;

        if (isCenter) {
          ctx.fillStyle = CONFIG.colors.priceTag;
          ctx.shadowColor = CONFIG.colors.priceTag;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(gridWidth + 2, y - 12, 70, 24, 4);
          } else {
            ctx.rect(gridWidth + 2, y - 12, 70, 24);
          }
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#fff";
          ctx.font = "bold 11px Inter, system-ui, sans-serif";
        } else {
          ctx.fillStyle = CONFIG.colors.textMuted;
          ctx.font = "10px Inter, system-ui, sans-serif";
        }

        ctx.textAlign = "right";
        ctx.fillText(`$${price.toFixed(2)}`, canvas.width - 5, y + 3);
      });

      animationRef.current = requestAnimationFrame(gameLoop);
    };

    animationRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [currentPrice, priceLevels, centerRow, getPriceRow, getCurrentCol, hapticSuccess, hapticError,
      playSound, recordWin, recordLoss, resetStreak, shakeBigLoss, shakeBigWin, shakeLoss,
      shakeStreak, shakeWin, stats, stakeAmount, checkAchievements, localStreak]);

  // Handle click to place position
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !currentPrice) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const { cellWidth, cellHeight, rows, visibleCols } = gridConfig;
    const gridWidth = visibleCols * cellWidth;
    const nowX = gridWidth * 0.2;
    const currentCol = getCurrentCol();

    const minClickDistance = cellWidth * 0.5;
    if (x <= nowX + minClickDistance || x >= gridWidth - 70) {
      showToast("Click further into the future", 'info');
      playSound('error');
      return;
    }

    if (localBalance < stakeAmount) {
      showToast("Insufficient balance", 'error');
      playSound('error');
      hapticError();
      return;
    }

    const row = Math.floor(y / cellHeight);
    if (row < 0 || row >= rows) return;

    const subPixelOffset = (currentCol % 1) * cellWidth;
    const clickedVisCol = Math.floor((x - nowX + subPixelOffset) / cellWidth);
    const targetCol = Math.floor(currentCol) + clickedVisCol;

    if (positions.some(p => p.row === row && p.targetCol === targetCol && p.status === "active")) {
      showToast("Position already exists here", 'info');
      playSound('error');
      return;
    }

    const rowDistance = row - centerRow;
    const colDistance = clickedVisCol;
    const multiplier = calculateMultiplier(rowDistance, colDistance, rows);
    const streakBonus = getStreakMultiplier(localStreak);
    const effectiveMultiplier = multiplier * streakBonus;
    const potentialPayout = stakeAmount * effectiveMultiplier;

    const direction = row < centerRow ? "up" : "down";
    const targetPrice = priceLevels[row];

    const newPosition: Position = {
      id: `pos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      row,
      targetCol,
      entryPrice: currentPrice,
      targetPrice,
      stake: stakeAmount,
      multiplier: effectiveMultiplier,
      potentialPayout,
      status: "active",
      direction,
      entryTime: Date.now(),
      resolveTime: Date.now() + (colDistance * CONFIG.msPerColumn),
    };

    setLocalBalance(b => b - stakeAmount);
    setStats(s => ({ ...s, totalBets: s.totalBets + 1 }));
    setPositions(prev => [...prev, newPosition]);

    hapticTap();
    playSound('bet');

    // Close stake panel if open
    if (showStakePanel) setShowStakePanel(false);

  }, [currentPrice, localBalance, stakeAmount, positions, priceLevels, centerRow, getCurrentCol,
      hapticTap, hapticError, playSound, localStreak, showStakePanel]);

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2000);
  };

  // Reset game state
  const handleReset = useCallback(() => {
    setLocalBalance(10000);
    setStats({
      totalBets: 0,
      totalWins: 0,
      totalLosses: 0,
      netPnL: 0,
      biggestWin: 0,
      biggestLoss: 0,
      sessionXP: 0,
      totalXP: 500,
    });
    setPositions([]);
    setLocalStreak(0);
    positionsRef.current = [];
    resultAnimationsRef.current = [];
    startTimeRef.current = Date.now();
    sessionStartRef.current = Date.now();
    showToast("Game reset! Good luck! 🎮", 'success');
    playSound('levelUp');
  }, [playSound]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  const canvasWidth = gridConfig.visibleCols * gridConfig.cellWidth + gridConfig.priceAxisWidth;
  const canvasHeight = gridConfig.rows * gridConfig.cellHeight;

  const winRate = stats.totalBets > 0
    ? ((stats.totalWins / stats.totalBets) * 100).toFixed(1)
    : "0.0";

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{
        ...shakeStyle,
        background: CONFIG.colors.bgGradient,
      }}
    >
      {/* Particle System */}
      <ParticleSystem onRef={(ref) => { particleSystemRef.current = ref; }} />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className={`
              fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl
              backdrop-blur-md border text-sm font-medium
              ${toast.type === 'error'
                ? 'bg-red-900/80 border-red-700 text-red-200'
                : toast.type === 'success'
                  ? 'bg-green-900/80 border-green-700 text-green-200'
                  : 'bg-purple-900/80 border-purple-700 text-white'
              }
            `}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Streak Popup */}
      <StreakPopup
        streak={popupStreak}
        show={showStreakPopup}
        onComplete={() => setShowStreakPopup(false)}
      />

      {/* Level Up Popup */}
      <LevelUpPopup
        newLevel={newLevel}
        show={showLevelUp}
        onComplete={() => setShowLevelUp(false)}
      />

      {/* Achievement Unlock Popup */}
      <AchievementUnlockPopup
        achievement={unlockedAchievement}
        show={!!unlockedAchievement}
        onComplete={() => setUnlockedAchievement(null)}
      />

      {/* Top Bar */}
      <div className={`flex items-center justify-between border-b border-purple-900/50 bg-black/30 backdrop-blur-sm ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Logo */}
          <h1 className={`font-black bg-gradient-to-r from-pink-500 via-purple-400 to-cyan-400 bg-clip-text text-transparent ${isMobile ? 'text-sm' : 'text-base'}`}>
            NEMO TAP
          </h1>

          {/* Price Badge */}
          <motion.button
            whileTap={{ scale: 0.95 }}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-lg bg-black/40 border border-purple-800/50 ${isMobile ? 'px-2 py-1 min-h-[36px]' : 'px-2 py-1'}`}
          >
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: isConnected ? CONFIG.colors.positive : CONFIG.colors.negative }} />
            <span className={`text-white font-bold ${isMobile ? 'text-xs' : 'text-sm'}`}>${currentPrice.toFixed(2)}</span>
            <ChevronDown size={isMobile ? 10 : 12} className="text-gray-400" />
          </motion.button>

          {/* Sound Toggle */}
          <SoundToggle className="hidden sm:flex" />
        </div>

        {/* Right side - Stats */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Streak Display */}
          <StreakDisplay streak={localStreak} size={isMobile ? "xs" : "sm"} showMultiplier={!isMobile} />

          {/* Level */}
          <LevelDisplay
            level={levelData.level}
            currentXP={levelData.currentXP}
            totalXP={stats.totalXP}
            compact
            className="hidden sm:flex"
          />

          {/* Win Rate */}
          <div className="hidden sm:flex items-center gap-1 text-xs">
            <Target size={12} className="text-purple-400" />
            <span className="text-gray-400">WR:</span>
            <span className="text-white font-bold">{winRate}%</span>
          </div>

          {/* P&L */}
          <div className={`flex items-center gap-1 font-bold ${stats.netPnL >= 0 ? 'text-green-400' : 'text-red-400'} ${isMobile ? 'text-xs' : 'text-xs'}`}>
            {stats.netPnL >= 0 ? <TrendingUp size={isMobile ? 10 : 12} /> : <TrendingDown size={isMobile ? 10 : 12} />}
            <span>{stats.netPnL >= 0 ? '+' : ''}{stats.netPnL.toFixed(isMobile ? 0 : 2)}</span>
          </div>
        </div>
      </div>

      {/* Tutorial Overlay */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowTutorial(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="max-w-sm mx-4 p-6 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-purple-500/30"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-6 h-6 text-purple-400" />
                <h2 className="text-xl font-bold text-white">How to Play</h2>
              </div>

              <div className="space-y-3 text-sm text-gray-300">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-purple-400 font-bold">1</span>
                  </div>
                  <p>Tap on a cell in the <span className="text-pink-400 font-semibold">future zone</span> (right side of the line)</p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-purple-400 font-bold">2</span>
                  </div>
                  <p>Higher rows = price <span className="text-green-400">goes UP</span>, Lower rows = price <span className="text-red-400">goes DOWN</span></p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-purple-400 font-bold">3</span>
                  </div>
                  <p>Win if the <span className="text-pink-400 font-semibold">pink line</span> hits your position when the column arrives</p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                    <Flame className="w-4 h-4 text-yellow-400" />
                  </div>
                  <p>Build <span className="text-orange-400 font-semibold">win streaks</span> for multiplier bonuses!</p>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowTutorial(false)}
                className="w-full mt-6 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold"
              >
                Got it!
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          onClick={handleCanvasClick}
          className="cursor-crosshair rounded-xl"
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            border: `1px solid ${CONFIG.colors.gridLine}`,
            boxShadow: "0 0 40px rgba(139, 92, 246, 0.2)",
          }}
        />
      </div>

      {/* Bottom Bar */}
      <div className={`flex items-center justify-between border-t border-purple-900/50 bg-black/30 backdrop-blur-sm ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        {/* Balance + Reset */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <motion.div
            whileTap={{ scale: 0.95 }}
            className={`flex items-center gap-1.5 sm:gap-2 rounded-xl bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-800/50 ${isMobile ? 'px-2 py-1.5 min-h-[40px]' : 'px-3 py-2'}`}
          >
            <Wallet size={isMobile ? 14 : 16} className="text-green-400" />
            <AnimatedNumber
              value={localBalance}
              format="currency"
              size={isMobile ? "sm" : "md"}
              highlightChange={true}
              className="font-bold text-white"
            />
          </motion.div>

          {/* Reset Button */}
          <motion.button
            whileTap={{ scale: 0.9, rotate: -180 }}
            onClick={handleReset}
            className={`rounded-lg bg-gray-800/50 border border-gray-700/50 hover:bg-red-900/30 hover:border-red-700/50 transition-colors ${isMobile ? 'p-2 min-h-[40px] min-w-[40px]' : 'p-2'}`}
            title="Reset Game"
          >
            <RotateCcw size={isMobile ? 14 : 16} className="text-gray-400 hover:text-red-400" />
          </motion.button>
        </div>

        {/* Quick Stats - Hidden on mobile to save space */}
        <div className={`items-center gap-2 sm:gap-3 text-xs ${isMobile ? 'hidden' : 'flex'}`}>
          <span className="flex items-center gap-1">
            <TrendingUp size={12} className="text-green-400" />
            <span className="text-green-400 font-bold">{stats.totalWins}</span>
          </span>
          <span className="flex items-center gap-1">
            <TrendingDown size={12} className="text-red-400" />
            <span className="text-red-400 font-bold">{stats.totalLosses}</span>
          </span>
          <span className="flex items-center gap-1 text-purple-400">
            <Zap size={12} />
            <span className="font-bold">{stats.sessionXP} XP</span>
          </span>
        </div>

        {/* Mobile compact stats */}
        {isMobile && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-green-400 font-bold">{stats.totalWins}W</span>
            <span className="text-red-400 font-bold">{stats.totalLosses}L</span>
          </div>
        )}

        {/* Stake Selector */}
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowStakePanel(!showStakePanel)}
            className={`
              flex items-center gap-1.5 sm:gap-2 rounded-xl font-bold
              ${isMobile ? 'px-2.5 py-1.5 min-h-[40px]' : 'px-3 py-2'}
              ${showStakePanel
                ? 'bg-purple-500 text-white'
                : 'bg-gradient-to-r from-purple-900/50 to-pink-900/50 border border-purple-700/50 text-white'
              }
            `}
          >
            <Settings size={isMobile ? 14 : 16} className={showStakePanel ? 'animate-spin' : ''} />
            <span className={isMobile ? 'text-sm' : ''}>${stakeAmount}</span>
          </motion.button>

          {/* Stake Panel */}
          <AnimatePresence>
            {showStakePanel && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className={`absolute bottom-full right-0 mb-2 p-4 rounded-2xl bg-gray-900/95 border border-purple-800/50 backdrop-blur-md shadow-2xl ${isMobile ? 'w-64 right-0 left-auto' : 'w-72'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-white">Stake Amount</h3>
                  <button onClick={() => setShowStakePanel(false)} className="p-1">
                    <X size={18} className="text-gray-400 hover:text-white" />
                  </button>
                </div>

                <StakeSelector
                  value={stakeAmount}
                  onChange={setStakeAmount}
                  balance={localBalance}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT (with providers)
// =============================================================================
export default function TradePage() {
  return (
    <SoundManagerProvider>
      <TradePageInner />
    </SoundManagerProvider>
  );
}
