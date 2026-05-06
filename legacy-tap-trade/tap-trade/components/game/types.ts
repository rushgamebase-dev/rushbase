// Types for the game board
export interface PlacedTile {
  id: string;
  row: number;
  col: number;
  value: number;        // Stake amount ($5, $10, etc.)
  multiplier: number;   // The multiplier at that cell
  priceLevel: number;   // The price level for this row
  direction: "UP" | "DOWN"; // Betting on price going up or down
  isInvalid?: boolean;  // Failed/invalid tile
  isLosing?: boolean;   // Currently losing position
  isWinning?: boolean;  // Currently winning position
  timestamp: number;    // When tile was placed
}

export interface GridCell {
  row: number;
  col: number;
  multiplier: number;
  priceLevel: number;
  hasTile: boolean;
}

export interface GameState {
  tiles: PlacedTile[];
  currentPrice: number;
  balance: number;
  stakeAmount: number;
  isPlacingTile: boolean;
}
