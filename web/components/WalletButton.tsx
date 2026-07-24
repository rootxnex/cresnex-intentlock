"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected)
    return <button className="wallet connected" onClick={() => disconnect()} aria-label="Disconnect wallet"><span className="network-dot" />{chain?.name ?? "Wallet"} <code>{address?.slice(0, 6)}…{address?.slice(-4)}</code></button>;
  return (
    <button className="wallet" disabled={!connectors[0]} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
      <span className="network-dot" />Connect wallet
    </button>
  );
}
