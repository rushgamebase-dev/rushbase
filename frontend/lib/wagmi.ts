import { http, createConfig, fallback } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

// TEMPORARY: Chainstack rejects getActiveMarkets() — 50M eth_call gas limit.
// Factory has 4838+ markets and the O(n) call needs ~50.6M gas. Primary is now
// Base official (higher limit) with Chainstack as fallback for all other reads.
// Proper fix: migrate frontend bootstrap to eth_getLogs/events, not polling.
const PRIMARY_RPC = "https://mainnet.base.org";
const FALLBACK_RPC =
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236";

const transport = fallback([
  http(PRIMARY_RPC, { retryCount: 2, retryDelay: 500 }),
  http(FALLBACK_RPC, { retryCount: 3, retryDelay: 1000 }),
]);

// WalletConnect Cloud projectId — get yours free at https://cloud.walletconnect.com
const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID || "83b7531d45db48105b33da04366b9455";

export const wagmiConfig = createConfig({
  chains: [base],
  ssr: true, // Defer localStorage reads until after hydration — fixes React #418
  connectors: [
    injected(), // MetaMask + Phantom (both inject as window.ethereum on EVM)
    coinbaseWallet({
      appName: "Rush",
    }),
    walletConnect({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: "Rush",
        description: "On-chain prediction market on Base",
        // rushgame.vip redirects to www. → match the final URL so WC metadata
        // doesn't mismatch the actual page origin (emits console warning).
        url: "https://www.rushgame.vip",
        icons: ["https://www.rushgame.vip/logo.png"],
      },
      showQrModal: true, // native WC modal — QR for desktop, deep-links for mobile
    }),
  ],
  transports: {
    [base.id]: transport,
  },
});

export { base };
