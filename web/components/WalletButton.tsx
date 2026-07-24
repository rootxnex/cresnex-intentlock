"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected)
    return <button className="wallet" onClick={() => disconnect()}>{address?.slice(0, 6)}…{address?.slice(-4)}</button>;
  return (
    <div className="wallet-options">
      {connectors.map((connector) => (
        <button className="wallet" key={connector.uid} onClick={() => connect({ connector })}>
          {connector.name}
        </button>
      ))}
    </div>
  );
}
