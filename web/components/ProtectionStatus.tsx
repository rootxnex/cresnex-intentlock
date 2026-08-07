"use client";

import { useReadContracts } from "wagmi";
import { accountV2Abi, accountV2Address, targetChainId } from "@/lib/contracts";

export function ProtectionStatus() {
  const configured = Boolean(accountV2Address);
  const status = useReadContracts({
    allowFailure: false,
    contracts: accountV2Address ? [
      { address: accountV2Address, abi: accountV2Abi, functionName: "owner", chainId: targetChainId },
      { address: accountV2Address, abi: accountV2Abi, functionName: "paused", chainId: targetChainId },
    ] : [],
    query: { enabled: configured, refetchInterval: 4_000, retry: 1 },
  });

  const paused = status.data?.[1] as boolean | undefined;
  const label = !configured
    ? "NOT CONNECTED"
    : status.isError
      ? "UNAVAILABLE"
      : paused === undefined
        ? "VERIFYING"
        : paused
          ? "PAUSED"
          : "ARMED";

  return (
    <div className={`protection-chip${label === "ARMED" ? " active" : ""}`}>
      <span className="status-dot" />
      <div><small>Protection state</small><strong>{label}</strong></div>
    </div>
  );
}
