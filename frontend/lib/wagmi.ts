import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://mainnet.base.org";

// HTTP-only transport. WebSocket RPC was causing infinite reconnect loops
// (ol→or in console) when the WSS endpoint was unreachable.
// Contract reads use polling (5s) which is fast enough.
// Real-time events come from Ably, not wagmi WebSocket.
const transport = http(RPC_URL);

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
