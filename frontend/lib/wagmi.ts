import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

// Alchemy RPC — public Base RPC was also hitting 429 rate limits.
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://optimistic-jackson:snout-repost-vest-tyke-runny-stays@base-mainnet.core.chainstack.com";

const transport = http(RPC_URL, {
  retryCount: 3,
  retryDelay: 1000,
});

export const wagmiConfig = createConfig({
  chains: [base],
  ssr: true, // Defer localStorage reads until after hydration — fixes React #418
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
