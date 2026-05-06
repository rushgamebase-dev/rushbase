"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Cookies from "js-cookie";
import { useStore } from "@/stores";
import type { Asset, WsServerMessage } from "@/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/ws";
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const HEARTBEAT_INTERVAL = 25000;

export function useWebSocketTrading() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const {
    isAuthenticated: userAuthenticated,
    updatePrice,
    updatePositionPnL,
    updateBalance,
    selectedAsset,
  } = useStore();

  const clearTimers = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = null;
    }
  }, []);

  const sendMessage = useCallback((type: string, payload?: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = payload ? { type, payload } : { type };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const authenticate = useCallback(() => {
    const token = Cookies.get("accessToken");
    if (token && wsRef.current?.readyState === WebSocket.OPEN) {
      sendMessage("Authenticate", { token });
    }
  }, [sendMessage]);

  const subscribeToAsset = useCallback(
    (asset: Asset) => {
      sendMessage("SubscribePrices", { symbols: [asset] });
    },
    [sendMessage]
  );

  const unsubscribeFromAsset = useCallback(
    (asset: Asset) => {
      sendMessage("UnsubscribePrices", { symbols: [asset] });
    },
    [sendMessage]
  );

  const subscribeToPositions = useCallback(() => {
    sendMessage("SubscribePositions");
  }, [sendMessage]);

  const subscribeToAccount = useCallback(() => {
    sendMessage("SubscribeAccount");
  }, [sendMessage]);

  const sendPing = useCallback(() => {
    sendMessage("Ping", { timestamp: Date.now() });
  }, [sendMessage]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as WsServerMessage;

        switch (message.type) {
          case "AuthResult":
            if (message.payload.success) {
              setIsAuthenticated(true);
              // Subscribe to positions and account after auth
              subscribeToPositions();
              subscribeToAccount();
            } else {
              console.error("WS Auth failed:", message.payload.error);
              setIsAuthenticated(false);
            }
            break;

          case "PriceUpdate":
            updatePrice(
              message.payload.symbol as Asset,
              parseFloat(message.payload.price)
            );
            break;

          case "PnLUpdate":
            message.payload.positions.forEach((pos) => {
              updatePositionPnL(pos.position_id, {
                currentPrice: parseFloat(pos.current_price),
                unrealizedPnl: parseFloat(pos.unrealized_pnl),
                roePercent: parseFloat(pos.roe_percent),
                marginRatio: parseFloat(pos.margin_ratio),
                distanceToLiqPercent: parseFloat(pos.distance_to_liq_percent),
              });
            });
            break;

          case "BalanceUpdate":
            updateBalance({
              availableBalance: parseFloat(message.payload.available_balance),
              lockedBalance: parseFloat(message.payload.locked_balance),
              totalBalance: parseFloat(message.payload.total_balance),
            });
            break;

          case "Subscribed":
            console.log("Subscribed to:", message.payload.channel);
            break;

          case "Unsubscribed":
            console.log("Unsubscribed from:", message.payload.channel);
            break;

          case "Pong":
            // Heartbeat response received
            break;

          case "Error":
            console.error("WS Error:", message.payload.code, message.payload.message);
            break;

          default:
            console.log("Unknown message:", message);
        }
      } catch (error) {
        console.error("Failed to parse WS message:", error);
      }
    },
    [updatePrice, updatePositionPnL, updateBalance, subscribeToPositions, subscribeToAccount]
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    clearTimers();

    try {
      wsRef.current = new WebSocket(WS_URL);

      wsRef.current.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        reconnectAttempts.current = 0;

        // Authenticate if user is logged in
        if (userAuthenticated) {
          authenticate();
        }

        // Subscribe to default asset prices
        subscribeToAsset(selectedAsset);

        // Start heartbeat
        heartbeatInterval.current = setInterval(sendPing, HEARTBEAT_INTERVAL);
      };

      wsRef.current.onmessage = handleMessage;

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      wsRef.current.onclose = (event) => {
        console.log("WebSocket closed:", event.code, event.reason);
        setIsConnected(false);
        setIsAuthenticated(false);
        clearTimers();

        // Attempt reconnection
        if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.current += 1;
          console.log(
            `Reconnecting... Attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS}`
          );
          reconnectTimeout.current = setTimeout(connect, RECONNECT_DELAY);
        } else {
          console.error("Max reconnection attempts reached");
        }
      };
    } catch (error) {
      console.error("Failed to create WebSocket:", error);
    }
  }, [
    userAuthenticated,
    selectedAsset,
    authenticate,
    subscribeToAsset,
    sendPing,
    handleMessage,
    clearTimers,
  ]);

  const disconnect = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsAuthenticated(false);
  }, [clearTimers]);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Re-authenticate when user auth state changes
  useEffect(() => {
    if (isConnected && userAuthenticated && !isAuthenticated) {
      authenticate();
    }
  }, [isConnected, userAuthenticated, isAuthenticated, authenticate]);

  // Switch asset subscription when selected asset changes
  useEffect(() => {
    if (isConnected) {
      // Subscribe to all assets for price updates
      const assets: Asset[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
      assets.forEach(subscribeToAsset);
    }
  }, [isConnected, subscribeToAsset]);

  return {
    isConnected,
    isAuthenticated,
    connect,
    disconnect,
    subscribeToAsset,
    unsubscribeFromAsset,
    subscribeToPositions,
    subscribeToAccount,
  };
}
