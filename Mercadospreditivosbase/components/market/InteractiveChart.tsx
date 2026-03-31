"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/**
 * InteractiveChart - Enterprise-grade chart inspired by Kalshi
 *
 * Features:
 * - Smooth hover interactions with crosshair and tooltips
 * - Step-chart style (horizontal then vertical) like Kalshi
 * - Gradient fill under lines
 * - Animated live indicator with pulse effect
 * - Time range selector
 * - Touch-friendly for mobile
 * - High DPI canvas rendering
 */

// Time range options
type TimeRange = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

const TIME_RANGES: { value: TimeRange; label: string }[] = [
    { value: "1H", label: "1H" },
    { value: "6H", label: "6H" },
    { value: "1D", label: "1D" },
    { value: "1W", label: "1W" },
    { value: "1M", label: "1M" },
    { value: "ALL", label: "ALL" },
];

export interface ChartDataPoint {
    timestamp: number; // Unix timestamp in ms
    value: number; // 0-100 percentage
    volume?: number;
}

export interface ChartOutcome {
    id: string;
    name: string;
    color: string;
    data: ChartDataPoint[];
}

interface InteractiveChartProps {
    outcomes: ChartOutcome[];
    height?: number;
    showTimeRange?: boolean;
    showTooltip?: boolean;
    showVolume?: boolean;
    defaultTimeRange?: TimeRange;
    onTimeRangeChange?: (range: TimeRange) => void;
    className?: string;
}

// Format timestamp for display
function formatTimestamp(ts: number, range: TimeRange): string {
    const date = new Date(ts);

    if (range === "1H" || range === "6H") {
        return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    }
    if (range === "1D") {
        return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    }
    if (range === "1W") {
        return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
    }
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

// Format full date for tooltip
function formatFullDate(ts: number): string {
    const date = new Date(ts);
    return date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function InteractiveChart({
    outcomes,
    height = 320,
    showTimeRange = true,
    showTooltip = true,
    showVolume = false,
    defaultTimeRange = "1M",
    onTimeRangeChange,
    className,
}: InteractiveChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [mounted, setMounted] = useState(false);
    const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange>(defaultTimeRange);

    // Hover state
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);

    // Animation state
    const animationRef = useRef<number | null>(null);
    const pulseRef = useRef<number | null>(null);
    const [animationProgress, setAnimationProgress] = useState(0);
    const [pulseProgress, setPulseProgress] = useState(0);

    // Chart padding
    const padding = useMemo(() => ({
        top: showTimeRange ? 48 : 16,
        right: 56,
        bottom: 40,
        left: 16,
    }), [showTimeRange]);

    // Calculate chart dimensions
    const chartWidth = Math.max(0, dimensions.width - padding.left - padding.right);
    const chartHeight = Math.max(0, dimensions.height - padding.top - padding.bottom);

    // Get max data points
    const maxDataPoints = useMemo(() => {
        return Math.max(...outcomes.map(o => o.data.length), 1);
    }, [outcomes]);

    // ResizeObserver
    useEffect(() => {
        setMounted(true);
        const container = containerRef.current;
        if (!container) return;

        const updateDimensions = () => {
            const rect = container.getBoundingClientRect();
            setDimensions({ width: rect.width, height: rect.height });
        };

        updateDimensions();
        const resizeObserver = new ResizeObserver(updateDimensions);
        resizeObserver.observe(container);

        return () => resizeObserver.disconnect();
    }, []);

    // Animation on mount
    useEffect(() => {
        if (!mounted) return;

        const startTime = performance.now();
        const duration = 800;

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic for smooth deceleration
            const eased = 1 - Math.pow(1 - progress, 3);
            setAnimationProgress(eased);

            if (progress < 1) {
                animationRef.current = requestAnimationFrame(animate);
            }
        };

        animationRef.current = requestAnimationFrame(animate);
        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [mounted, outcomes]);

    // Continuous pulse animation
    useEffect(() => {
        if (!mounted) return;

        const animatePulse = (currentTime: number) => {
            const cycle = (currentTime % 2000) / 2000;
            const pulse = (Math.sin(cycle * Math.PI * 2 - Math.PI / 2) + 1) / 2;
            setPulseProgress(pulse);
            pulseRef.current = requestAnimationFrame(animatePulse);
        };

        pulseRef.current = requestAnimationFrame(animatePulse);
        return () => {
            if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
        };
    }, [mounted]);

    // Convert data point to canvas coordinates
    const getPoint = useCallback((dataIndex: number, value: number, totalPoints: number) => {
        const x = padding.left + (dataIndex / Math.max(totalPoints - 1, 1)) * chartWidth;
        const y = padding.top + chartHeight - (value / 100) * chartHeight;
        return { x, y };
    }, [chartWidth, chartHeight, padding]);

    // Draw chart on canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || dimensions.width <= 0 || dimensions.height <= 0 || chartWidth <= 0 || chartHeight <= 0) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Set canvas resolution for retina displays
        const dpr = window.devicePixelRatio || 1;
        canvas.width = dimensions.width * dpr;
        canvas.height = dimensions.height * dpr;
        ctx.scale(dpr, dpr);

        // Clear canvas
        ctx.clearRect(0, 0, dimensions.width, dimensions.height);

        // Always dark theme
        // Draw subtle background gradient for contrast
        const bgGradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
        bgGradient.addColorStop(0, "rgba(17, 17, 17, 0.6)");
        bgGradient.addColorStop(0.5, "rgba(10, 10, 10, 0.4)");
        bgGradient.addColorStop(1, "rgba(17, 17, 17, 0.2)");
        ctx.fillStyle = bgGradient;
        ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

        // Draw subtle dot pattern for texture
        ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
        const dotSpacing = 20;
        for (let x = padding.left; x < padding.left + chartWidth; x += dotSpacing) {
            for (let y = padding.top; y < padding.top + chartHeight; y += dotSpacing) {
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Draw subtle grid lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);

        // Horizontal grid at 25%, 50%, 75%
        [25, 50, 75].forEach(percent => {
            const y = padding.top + chartHeight - (percent / 100) * chartHeight;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        });

        // Calculate visible points based on animation
        const visiblePoints = Math.floor(maxDataPoints * animationProgress);

        // Draw each outcome
        outcomes.forEach((outcome) => {
            if (outcome.data.length === 0) return;

            const pointsToDraw = Math.min(visiblePoints, outcome.data.length);
            if (pointsToDraw < 1) return;

            // Draw gradient fill first (behind line)
            if (pointsToDraw > 1) {
                ctx.beginPath();

                for (let i = 0; i < pointsToDraw; i++) {
                    const point = outcome.data[i];
                    const { x, y } = getPoint(i, point.value, outcome.data.length);

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        // Step chart: horizontal then vertical
                        const prev = getPoint(i - 1, outcome.data[i - 1].value, outcome.data.length);
                        ctx.lineTo(x, prev.y);
                        ctx.lineTo(x, y);
                    }
                }

                // Close path to bottom
                const last = getPoint(pointsToDraw - 1, outcome.data[pointsToDraw - 1].value, outcome.data.length);
                const first = getPoint(0, outcome.data[0].value, outcome.data.length);
                ctx.lineTo(last.x, padding.top + chartHeight);
                ctx.lineTo(first.x, padding.top + chartHeight);
                ctx.closePath();

                // Gradient fill
                const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
                gradient.addColorStop(0, outcome.color + "25");
                gradient.addColorStop(0.5, outcome.color + "10");
                gradient.addColorStop(1, outcome.color + "00");
                ctx.fillStyle = gradient;
                ctx.fill();
            }

            // Draw main line
            ctx.strokeStyle = outcome.color;
            ctx.lineWidth = 2.5;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();

            for (let i = 0; i < pointsToDraw; i++) {
                const point = outcome.data[i];
                const { x, y } = getPoint(i, point.value, outcome.data.length);

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    // Step chart style
                    const prev = getPoint(i - 1, outcome.data[i - 1].value, outcome.data.length);
                    ctx.lineTo(x, prev.y);
                    ctx.lineTo(x, y);
                }
            }

            ctx.stroke();

            // Draw live pulse indicator at end (when not hovering)
            if (hoverIndex === null && pointsToDraw > 0) {
                const lastIdx = pointsToDraw - 1;
                const lastPoint = outcome.data[lastIdx];
                const { x: lastX, y: lastY } = getPoint(lastIdx, lastPoint.value, outcome.data.length);

                // Outer pulse glow
                ctx.beginPath();
                const glowRadius = 12 + pulseProgress * 4;
                const glowOpacity = Math.round((0.1 + pulseProgress * 0.15) * 255).toString(16).padStart(2, '0');
                ctx.arc(lastX, lastY, glowRadius, 0, Math.PI * 2);
                ctx.fillStyle = outcome.color + glowOpacity;
                ctx.fill();

                // Middle ring
                ctx.beginPath();
                ctx.arc(lastX, lastY, 6 + pulseProgress * 2, 0, Math.PI * 2);
                ctx.strokeStyle = outcome.color + "40";
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // White background
                ctx.beginPath();
                ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
                ctx.fillStyle = "white";
                ctx.fill();

                // Inner dot
                ctx.beginPath();
                ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = outcome.color;
                ctx.fill();
            }
        });

        // Draw hover crosshair and dots
        if (hoverIndex !== null && hoverPosition) {
            const x = padding.left + (hoverIndex / Math.max(maxDataPoints - 1, 1)) * chartWidth;

            // Vertical crosshair line
            ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw dots at intersection for each outcome
            outcomes.forEach(outcome => {
                if (hoverIndex < outcome.data.length) {
                    const point = outcome.data[hoverIndex];
                    const { x: px, y: py } = getPoint(hoverIndex, point.value, outcome.data.length);

                    // White halo
                    ctx.beginPath();
                    ctx.arc(px, py, 8, 0, Math.PI * 2);
                    ctx.fillStyle = "white";
                    ctx.fill();

                    // Colored ring
                    ctx.beginPath();
                    ctx.arc(px, py, 6, 0, Math.PI * 2);
                    ctx.strokeStyle = outcome.color;
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    // Inner dot
                    ctx.beginPath();
                    ctx.arc(px, py, 3, 0, Math.PI * 2);
                    ctx.fillStyle = outcome.color;
                    ctx.fill();
                }
            });
        }

    }, [dimensions, outcomes, maxDataPoints, animationProgress, pulseProgress, hoverIndex, hoverPosition, getPoint, chartWidth, chartHeight, padding]);

    // Handle mouse/touch move
    const handlePointerMove = useCallback((clientX: number, clientY: number) => {
        const container = containerRef.current;
        if (!container || chartWidth <= 0) return;

        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const relativeX = x - padding.left;
        const dataIndex = Math.round((relativeX / chartWidth) * (maxDataPoints - 1));

        if (dataIndex >= 0 && dataIndex < maxDataPoints && relativeX >= 0 && relativeX <= chartWidth) {
            setHoverIndex(dataIndex);
            setHoverPosition({ x, y });
        } else {
            setHoverIndex(null);
            setHoverPosition(null);
        }
    }, [chartWidth, maxDataPoints, padding.left]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        handlePointerMove(e.clientX, e.clientY);
    }, [handlePointerMove]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (e.touches.length > 0) {
            handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, [handlePointerMove]);

    const handlePointerLeave = useCallback(() => {
        setHoverIndex(null);
        setHoverPosition(null);
    }, []);

    // Handle time range change
    const handleTimeRangeChange = useCallback((range: TimeRange) => {
        setSelectedTimeRange(range);
        onTimeRangeChange?.(range);
    }, [onTimeRangeChange]);

    // Get current values for display
    const getCurrentValues = useCallback(() => {
        return outcomes.map(outcome => {
            const index = hoverIndex !== null && hoverIndex < outcome.data.length
                ? hoverIndex
                : outcome.data.length - 1;
            const point = outcome.data[index];
            return {
                ...outcome,
                currentValue: point?.value || 0,
                currentTimestamp: point?.timestamp || Date.now(),
            };
        });
    }, [outcomes, hoverIndex]);

    const currentValues = getCurrentValues();

    // X-axis labels
    const xAxisLabels = useMemo(() => {
        if (outcomes.length === 0 || outcomes[0].data.length < 2) return [];

        const firstOutcome = outcomes[0];
        const dataLength = firstOutcome.data.length;
        const labelCount = Math.min(5, dataLength);
        const step = Math.floor((dataLength - 1) / (labelCount - 1));

        const labels = [];
        for (let i = 0; i < labelCount; i++) {
            const index = Math.min(i * step, dataLength - 1);
            const point = firstOutcome.data[index];
            if (point) {
                labels.push({
                    index,
                    label: formatTimestamp(point.timestamp, selectedTimeRange),
                    x: padding.left + (index / Math.max(dataLength - 1, 1)) * chartWidth,
                });
            }
        }
        return labels;
    }, [outcomes, selectedTimeRange, chartWidth, padding.left]);

    const isReady = mounted && dimensions.width > 0 && dimensions.height > 0;

    return (
        <div
            ref={containerRef}
            className={`w-full relative select-none${className ? ` ${className}` : ""}`}
            style={{ height }}
            onMouseMove={isReady ? handleMouseMove : undefined}
            onMouseLeave={isReady ? handlePointerLeave : undefined}
            onTouchMove={isReady ? handleTouchMove : undefined}
            onTouchEnd={isReady ? handlePointerLeave : undefined}
        >
            {/* Loading skeleton */}
            {!isReady && (
                <div className="absolute inset-0 animate-pulse rounded-lg" style={{ background: "#111" }} />
            )}

            {isReady && (
                <>
                    {/* Time Range Selector */}
                    {showTimeRange && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 z-20">
                            {TIME_RANGES.map((range) => (
                                <button
                                    key={range.value}
                                    onClick={() => handleTimeRangeChange(range.value)}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all${
                                        selectedTimeRange === range.value
                                            ? " bg-primary text-black shadow-sm"
                                            : " hover:text-white"
                                    }`}
                                    style={{
                                        fontFamily: "monospace",
                                        color: selectedTimeRange === range.value ? "#000" : "#666",
                                        backgroundColor: selectedTimeRange === range.value ? "#00ff88" : undefined,
                                    }}
                                >
                                    {range.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Legend at top-left showing current values */}
                    <div className="absolute top-2 left-2 flex items-center gap-4 z-20">
                        {currentValues.map((outcome) => (
                            <div key={outcome.id} className="flex items-center gap-2">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: outcome.color }}
                                />
                                <span
                                    className="text-xs font-medium"
                                    style={{ color: "#999", fontFamily: "monospace" }}
                                >
                                    {outcome.name}
                                </span>
                                <span
                                    className="text-sm font-bold"
                                    style={{ color: outcome.color, fontFamily: "monospace" }}
                                >
                                    {outcome.currentValue.toFixed(0)}%
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Hover tooltip */}
                    {showTooltip && hoverIndex !== null && hoverPosition && (
                        <div
                            className="absolute z-30 pointer-events-none"
                            style={{
                                left: Math.min(hoverPosition.x + 16, dimensions.width - 180),
                                top: Math.max(padding.top, hoverPosition.y - 60),
                            }}
                        >
                            <div
                                className="px-3 py-2 rounded-lg shadow-xl text-xs backdrop-blur-sm"
                                style={{
                                    background: "rgba(17, 17, 17, 0.95)",
                                    border: "1px solid rgba(0, 255, 136, 0.2)",
                                    fontFamily: "monospace",
                                }}
                            >
                                <div
                                    className="mb-1.5 font-medium"
                                    style={{ color: "#666" }}
                                >
                                    {outcomes[0]?.data[hoverIndex] && formatFullDate(outcomes[0].data[hoverIndex].timestamp)}
                                </div>
                                {currentValues.map((outcome) => (
                                    <div key={outcome.id} className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: outcome.color }}
                                            />
                                            <span style={{ color: "#ccc" }}>{outcome.name}</span>
                                        </div>
                                        <span className="font-bold" style={{ color: outcome.color }}>
                                            {outcome.currentValue.toFixed(1)}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Canvas */}
                    <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full z-0"
                        style={{ width: dimensions.width, height: dimensions.height }}
                    />

                    {/* Y-axis labels - Right side */}
                    <div
                        className="absolute right-2 w-[40px] flex flex-col justify-between text-[11px] font-semibold z-10 text-right"
                        style={{
                            top: padding.top,
                            height: chartHeight,
                            color: "#666",
                            fontFamily: "monospace",
                        }}
                    >
                        <span>100%</span>
                        <span>75%</span>
                        <span>50%</span>
                        <span>25%</span>
                        <span>0%</span>
                    </div>

                    {/* X-axis labels */}
                    {xAxisLabels.length > 0 && (
                        <div
                            className="absolute left-0 right-0 text-[10px] font-medium z-10"
                            style={{
                                top: padding.top + chartHeight + 8,
                                color: "#666",
                                fontFamily: "monospace",
                            }}
                        >
                            {xAxisLabels.map((label, i) => (
                                <span
                                    key={i}
                                    className="absolute whitespace-nowrap"
                                    style={{
                                        left: label.x,
                                        transform: "translateX(-50%)",
                                    }}
                                >
                                    {label.label}
                                </span>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
