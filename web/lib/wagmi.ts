"use client";
import { createConfig, http } from "wagmi";
import { baseSepolia, foundry } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const connectors = [
  injected(),
  ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : []),
];

export const config = createConfig({
  chains: [baseSepolia, foundry],
  connectors,
  transports: {
    [baseSepolia.id]: http(
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    ),
    [foundry.id]: http(process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:8545"),
  },
  ssr: true,
});
