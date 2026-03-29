import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

// Use Base public RPC — Chainstack free tier was hitting 429 rate limits.
// Public RPC has no per-user rate limit.
const RPC_URL = "https://mainnet.base.org";

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
