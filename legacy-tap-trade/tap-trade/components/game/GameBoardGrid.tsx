"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { UI_CONFIG } from "@/lib/ui-config";
import type { PlacedTile } from "./types";

interface GameBoardGridProps {
  currentPrice: number;
  priceStep: number;
  rows?: number;
  columns?: number;
  tiles: PlacedTile[];
  onCellClick: (row: number, col: number, priceLevel: number, multiplier: number) => void;
  onCellHover?: (row: number, col: number) => void;
  invalidCell?: { row: number; col: number } | null;
}

export function GameBoardGrid({
  currentPrice,
  priceStep,
  rows = UI_CONFIG.grid.rows,
  columns = UI_CONFIG.grid.columns,
  tiles,
  onCellClick,
  onCellHover,
  invalidCell,
}: GameBoardGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  const [flashCell, setFlashCell] = useState<{ row: number; col: number } | null>(null);

  const { colors, grid, typography } = UI_CONFIG;

  // Generate price levels (higher prices at top)
  const priceLevels = Array.from({ length: rows }, (_, i) => {
    const rowFromTop = i;
    const rowFromMiddle = rowFromTop - Math.floor(rows / 2);
    return currentPrice + (Math.floor(rows / 2) - rowFromTop) * priceStep;
  });

  // Generate time columns (for multiplier variation)
  const timeColumns = Array.from({ length: columns }, (_, i) => i);

  // Calculate multiplier for a cell
  const getMultiplier = useCallback((row: number, col: number): number => {
    const priceLevel = priceLevels[row];
    const distance = Math.abs(priceLevel - currentPrice) / currentPrice;
    // Add variation based on column (time) - cells further right have higher multipliers
    const timeBonus = (col / columns) * 0.5;
    const baseMultiplier = 1 + (distance * 50) + timeBonus;
    return Math.round(baseMultiplier * 100) / 100;
  }, [priceLevels, currentPrice, columns]);

  // Handle invalid cell flash
  useEffect(() => {
    if (invalidCell) {
      setFlashCell(invalidCell);
      const timer = setTimeout(() => setFlashCell(null), UI_CONFIG.animations.invalidFlashDuration);
      return () => clearTimeout(timer);
    }
  }, [invalidCell]);

  const handleCellClick = (row: number, col: number) => {
    const priceLevel = priceLevels[row];
    const multiplier = getMultiplier(row, col);
    onCellClick(row, col, priceLevel, multiplier);
  };

  const handleCellHover = (row: number, col: number) => {
    setHoveredCell({ row, col });
    onCellHover?.(row, col);
  };

  // Check if a tile exists at position
  const getTileAtPosition = (row: number, col: number): PlacedTile | undefined => {
    return tiles.find(t => t.row === row && t.col === col);
  };

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      style={{
        backgroundColor: colors.bgGrid,
      }}
    >
      {/* Grid container */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, ${grid.cellWidth}px)`,
          gridTemplateRows: `repeat(${rows}, ${grid.cellHeight}px)`,
          gap: 0,
        }}
      >
        {priceLevels.map((priceLevel, row) =>
          timeColumns.map((_, col) => {
            const multiplier = getMultiplier(row, col);
            const isHovered = hoveredCell?.row === row && hoveredCell?.col === col;
            const isFlashing = flashCell?.row === row && flashCell?.col === col;
            const tile = getTileAtPosition(row, col);
            const hasTile = !!tile;

            return (
              <div
                key={`${row}-${col}`}
                onClick={() => !hasTile && handleCellClick(row, col)}
                onMouseEnter={() => handleCellHover(row, col)}
                onMouseLeave={() => setHoveredCell(null)}
                className="relative flex items-center justify-center cursor-pointer transition-colors"
                style={{
                  width: grid.cellWidth,
                  height: grid.cellHeight,
                  backgroundColor: isFlashing
                    ? colors.gridInvalid
                    : isHovered && !hasTile
                    ? colors.gridHover
                    : row % 2 === 0
                    ? colors.bgGrid
                    : colors.bgSecondary,
                  borderRight: `${grid.lineWidth}px solid ${colors.gridLine}`,
                  borderBottom: `${grid.lineWidth}px solid ${colors.gridLine}`,
                  transition: `background-color ${UI_CONFIG.animations.hoverDuration}ms`,
                }}
              >
                {/* Multiplier text (always visible, behind tile) */}
                {!hasTile && (
                  <span
                    style={{
                      fontSize: typography.multiplierSize,
                      fontWeight: typography.multiplierWeight,
                      color: colors.textMultiplier,
                      fontFamily: typography.fontFamily,
                    }}
                  >
                    {multiplier.toFixed(2)}X
                  </span>
                )}

                {/* Tile overlay */}
                {tile && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center z-10"
                    style={{
                      backgroundColor: tile.isInvalid
                        ? colors.tileInvalid
                        : tile.isLosing
                        ? colors.tileLosing
                        : colors.tileYellow,
                      borderRadius: UI_CONFIG.tiles.borderRadius,
                      margin: 2,
                      border: `${UI_CONFIG.tiles.borderWidth}px solid ${
                        tile.isInvalid ? "#cc3300" : colors.tileYellowDark
                      }`,
                    }}
                  >
                    <span
                      style={{
                        fontSize: typography.tileValueSize,
                        fontWeight: 700,
                        color: colors.tileText,
                        lineHeight: 1.2,
                      }}
                    >
                      ${tile.value}
                    </span>
                    <span
                      style={{
                        fontSize: typography.tileMultiplierSize,
                        fontWeight: 500,
                        color: colors.tileText,
                        opacity: 0.8,
                        lineHeight: 1,
                      }}
                    >
                      {tile.multiplier.toFixed(2)}X
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Top grid border */}
      <div
        className="absolute top-0 left-0 right-0"
        style={{
          height: grid.lineWidth,
          backgroundColor: colors.gridLine,
        }}
      />

      {/* Left grid border */}
      <div
        className="absolute top-0 left-0 bottom-0"
        style={{
          width: grid.lineWidth,
          backgroundColor: colors.gridLine,
        }}
      />
    </div>
  );
}
