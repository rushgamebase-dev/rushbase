import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

// Alchemy RPC — public Base RPC was also hitting 429 rate limits.
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236";

const transport = http(RPC_URL, {
  retryCount: 3,
  retryDelay: 1000,
});

// WalletConnect Cloud projectId — get yours free at https://cloud.walletconnect.com
const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WC_PROJECT_ID || "e9e1e5e2c6f7d4a3b8c9d0e1f2a3b4c5";

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
        url: "https://rushgame.vip",
        icons: ["https://rushgame.vip/logo.png"],
      },
      showQrModal: true, // native WC modal — QR for desktop, deep-links for mobile
    }),
  ],
  transports: {
    [base.id]: transport,
  },
});

export { base };
