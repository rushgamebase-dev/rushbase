import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ||
  "https://base-mainnet.g.alchemy.com/v2/yb-_ffZrf6Uk_dgEbvRQD";

const transport = http(RPC_URL, {
  retryCount: 3,
  retryDelay: 1000,
});

export const wagmiConfig = createConfig({
  chains: [base],
  ssr: true,
  connectors: [
    injected(),
    coinbaseWallet({
      appName: "Rush Markets",
    }),
  ],
  transports: {
    [base.id]: transport,
  },
});

export { base };
