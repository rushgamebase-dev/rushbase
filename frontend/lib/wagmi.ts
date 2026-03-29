import { http, webSocket, fallback, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

// Note: walletConnect removed — placeholder projectId caused errors.
// MetaMask and Phantom both inject as window.ethereum on EVM chains.
// Coinbase Wallet has its own connector.

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

export const WSS_URL = process.env.NEXT_PUBLIC_WSS_URL || "";

// Use WebSocket transport for real-time event subscriptions (BetPlaced, etc.)
// Falls back to HTTP if WSS unavailable.
const transport = WSS_URL
  ? fallback([webSocket(WSS_URL), http(RPC_URL)])
  : http(RPC_URL);

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    injected(), // MetaMask + Phantom (both inject as window.ethereum on EVM)
    coinbaseWallet({
      appName: "Rush",
    }),
  ],
  transports: {
    [base.id]: transport,
  },
});

export { base };
