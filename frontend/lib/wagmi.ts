import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

const projectId = "rush_prediction_market_wc";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236";

export const WSS_URL = process.env.NEXT_PUBLIC_WSS_URL || "wss://base-mainnet.core.chainstack.com/977532e58b2430d1f01739e7d209d236";

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    injected(),
    walletConnect({
      projectId,
    }),
    coinbaseWallet({
      appName: "Rush",
    }),
  ],
  transports: {
    [base.id]: http(RPC_URL),
  },
});

export { base };
