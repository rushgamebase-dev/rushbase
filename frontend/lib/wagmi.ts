import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

// Alchemy RPC — public Base RPC was also hitting 429 rate limits.
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://base-mainnet.core.chainstack.com/40dd80590171256d1e3835f1a5972f83";

const transport = http(RPC_URL, {
  retryCount: 3,
  retryDelay: 1000,
  // Consolidate simultaneous reads into a single Multicall3 eth_call.
  // Keeps client-side RPC usage below Chainstack RPS quota.
  batch: { batchSize: 32, wait: 16 },
});

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
