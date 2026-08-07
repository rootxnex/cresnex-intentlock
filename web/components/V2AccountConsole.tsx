"use client";

import { useState } from "react";
import { isAddress, type Address } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { accountV2Abi, accountV2Address, targetChainId } from "@/lib/contracts";

const short = (value?: string) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

export function V2AccountConsole() {
  const { address, chain } = useAccount();
  const [agent, setAgent] = useState("");
  const [threshold, setThreshold] = useState("3");
  const [nonce, setNonce] = useState("");
  const configured = Boolean(accountV2Address);

  const reads = useReadContracts({
    allowFailure: true,
    contracts: accountV2Address ? [
      { address: accountV2Address, abi: accountV2Abi, functionName: "owner", chainId: targetChainId },
      { address: accountV2Address, abi: accountV2Abi, functionName: "paused", chainId: targetChainId },
      { address: accountV2Address, abi: accountV2Abi, functionName: "quarantineThreshold", chainId: targetChainId },
    ] : [],
    query: { enabled: configured, refetchInterval: 4_000 },
  });
  const owner = reads.data?.[0]?.result as Address | undefined;
  const paused = reads.data?.[1]?.result as boolean | undefined;
  const quarantineThreshold = reads.data?.[2]?.result as bigint | undefined;
  const readFailed = reads.isError || Boolean(reads.data?.some((result) => result.status === "failure"));
  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());
  const selectedAgent = isAddress(agent) ? agent as Address : undefined;

  const agentRead = useReadContract({
    address: accountV2Address,
    abi: accountV2Abi,
    functionName: "agents",
    args: selectedAgent ? [selectedAgent] : undefined,
    query: { enabled: Boolean(accountV2Address && selectedAgent), refetchInterval: 3_000 },
  });
  const agentState = agentRead.data as readonly [boolean, boolean, bigint] | undefined;

  const writer = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: writer.data });
  const busy = writer.isPending || receipt.isLoading;
  const validThreshold = /^\d+$/.test(threshold) && BigInt(threshold) > 0n;
  const validNonce = /^\d+$/.test(nonce);

  function write(functionName: string, args: readonly unknown[] = []) {
    if (!accountV2Address) return;
    writer.writeContract({ address: accountV2Address, abi: accountV2Abi, functionName, args });
  }

  const role = !address ? "Connect wallet"
    : !owner ? "Unknown"
      : isOwner ? "Owner"
        : agentState?.[0] ? "Registered agent"
          : "Unregistered wallet";

  return (
    <>
      <section className="stats" aria-label="IntentLock V2 status">
        <article><span>V2 account</span><strong>{short(accountV2Address)}</strong><small>{configured ? "Configured for this dashboard" : "Deployment not connected"}</small></article>
        <article><span>Wallet role</span><strong>{role}</strong><small>{short(address)}</small></article>
        <article><span>Network</span><strong>{chain?.name ?? "Not connected"}</strong><small>{chain ? `Chain ID ${chain.id}` : "Connect a wallet"}</small></article>
        <article><span>Protection</span><strong className={paused === false ? "green" : ""}>{paused === undefined ? "Unknown" : paused ? "Paused" : "Active"}</strong><small>Threshold {quarantineThreshold?.toString() ?? "—"}</small></article>
      </section>

      {!configured && <section className="panel setup-state" aria-labelledby="v2-setup-title">
        <div className="eyebrow">Deployment required</div>
        <h2 id="v2-setup-title">IntentLock V2 is not connected to this dashboard.</h2>
        <p className="muted">Add the public V2 account address and deployment block for a verified local Anvil or Base Sepolia research deployment. No private key belongs in browser configuration.</p>
        <details>
          <summary>Technical configuration</summary>
          <code>NEXT_PUBLIC_ACCOUNT_V2_ADDRESS · NEXT_PUBLIC_DEPLOYMENT_V2_BLOCK</code>
        </details>
      </section>}

      {configured && readFailed && <p className="error-note" role="alert">The configured V2 contract could not be verified on chain {targetChainId}. Controls remain disabled until its public state can be read.</p>}

      {configured && <section className="panel owner-panel" id="v2-agents">
        <div className="panel-number">V2 / OWNER</div>
        <div className="eyebrow">Verified onchain controls</div>
        <h2>V2 agent and recovery controls</h2>
        <p className="muted">These actions write directly to the configured V2 account. Emergency revocation both unregisters and quarantines the selected agent.</p>
        <div className="form-grid">
          <label className="wide">Agent address<input value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="0x…" aria-invalid={Boolean(agent && !selectedAgent)} /></label>
          <label>Quarantine threshold<input type="number" min="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
          <label>Nonce to cancel<input value={nonce} onChange={(event) => setNonce(event.target.value)} inputMode="numeric" placeholder="Unsigned integer" /></label>
        </div>
        <div className="policy" aria-live="polite">
          <span>Registered <strong>{agentState ? (agentState[0] ? "Yes" : "No") : "—"}</strong></span>
          <span>Quarantined <strong>{agentState ? (agentState[1] ? "Yes" : "No") : "—"}</strong></span>
          <span>Strikes <strong>{agentState?.[2]?.toString() ?? "—"}</strong></span>
        </div>
        <div className="control-row">
          <button disabled={readFailed || !isOwner || !selectedAgent || busy} onClick={() => write("registerAgent", [selectedAgent])}>Register agent</button>
          <button disabled={!isOwner || !selectedAgent || busy} onClick={() => write("removeAgent", [selectedAgent])}>Remove agent</button>
          <button className="danger-control" disabled={!isOwner || !selectedAgent || busy} onClick={() => write("emergencyRevokeAgent", [selectedAgent])}>Emergency revoke</button>
          <button disabled={!isOwner || !selectedAgent || busy} onClick={() => write("resetAgentStrikes", [selectedAgent])}>Reset strikes</button>
          <button disabled={!isOwner || !selectedAgent || busy} onClick={() => write("unquarantineAgent", [selectedAgent])}>Unquarantine</button>
          <button disabled={!isOwner || busy} onClick={() => write(paused ? "unpause" : "pause")}>{paused ? "Unpause account" : "Pause account"}</button>
          <button disabled={!isOwner || busy || !validThreshold} onClick={() => write("setQuarantineThreshold", [BigInt(threshold)])}>Set threshold</button>
          <button disabled={!isOwner || busy || !validNonce} onClick={() => write("cancelNonce", [BigInt(nonce)])}>Cancel nonce</button>
        </div>
        {!isOwner && <p className="demo-note">Connect the V2 account owner to enable these controls.</p>}
        {writer.error && <p className="error-note" role="alert">Wallet action failed: {writer.error.message.split("\n")[0]}</p>}
        {receipt.isSuccess && <p className="success-note" role="status">Transaction confirmed in block {receipt.data.blockNumber.toString()}.</p>}
      </section>}
    </>
  );
}
