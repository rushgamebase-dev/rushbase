import { http, webSocket, fallback, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

// Note: walletConnect removed — placeholder projectId caused errors.
// MetaMask and Phantom both inject as window.ethereum on EVM chains.
// Coinbase Wallet has its own connector.

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

export const WSS_URL = process.env.NEXT_PUBLIC_WSS_URL || "";

// HTTP transport is ALWAYS the primary — reliable, works everywhere.
// WebSocket is added as secondary for event subscriptions when available.
// Previous fallback([webSocket, http]) broke silently when WSS failed to init.
const transport = WSS_URL
  ? fallback([http(RPC_URL), webSocket(WSS_URL)])
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
  // 2s polling for HTTP fallback — ensures contract reads + event detection
  // stay responsive even when WSS is unavailable.
  pollingInterval: 2_000,
});

export { base };
