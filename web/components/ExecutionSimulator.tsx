"use client";

import { useCallback, useEffect, useState } from "react";
import { type Address, type Hex } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { accountAbi, accountAddress } from "@/lib/contracts";
import type { ExecutionCall } from "@/lib/intent";

type SavedIntent = {
  scenario: string;
  manifest: {
    account: Address; agent: Address; chainId: string; callsHash: Hex;
    inputToken: Address; maxInputAmount: string; outputToken: Address; minOutputAmount: string;
    recipient: Address; approvalToken: Address; approvalSpender: Address; maxFinalAllowance: string;
    nonce: string; validAfter: number; validUntil: number; allowBatch: boolean;
  };
  calls: Array<{ target: Address; value: string; data: Hex }>;
  ownerSignature: Hex;
};

export function ExecutionSimulator() {
  const { address } = useAccount();
  const [saved, setSaved] = useState<SavedIntent | null>(null);
  const load = useCallback(() => {
    const value = localStorage.getItem("cresnex.signedIntent");
    setSaved(value ? JSON.parse(value) as SavedIntent : null);
  }, []);
  useEffect(() => {
    load();
    window.addEventListener("cresnex:intent-signed", load);
    return () => window.removeEventListener("cresnex:intent-signed", load);
  }, [load]);

  const writer = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: writer.data });
  const isAgent = Boolean(saved && address && saved.manifest.agent.toLowerCase() === address.toLowerCase());

  function execute() {
    if (!saved || !accountAddress) return;
    const manifest = {
      ...saved.manifest,
      chainId: BigInt(saved.manifest.chainId),
      maxInputAmount: BigInt(saved.manifest.maxInputAmount),
      minOutputAmount: BigInt(saved.manifest.minOutputAmount),
      maxFinalAllowance: BigInt(saved.manifest.maxFinalAllowance),
      nonce: BigInt(saved.manifest.nonce),
    };
    const calls: ExecutionCall[] = saved.calls.map((call) => ({ ...call, value: BigInt(call.value) }));
    writer.writeContract({
      address: accountAddress,
      abi: accountAbi,
      functionName: "executeIntent",
      args: [manifest, calls, saved.ownerSignature],
    });
  }

  return (
    <section className="panel simulator">
      <div className="panel-number">02 — EXECUTION</div>
      <div className="eyebrow">Agent simulator</div>
      <h2>Submit signed intent</h2>
      {!saved && <p className="muted">Connect the owner and sign a scenario in the intent builder first.</p>}
      {saved && <>
        <div className="policy">
          <span>Scenario <strong>{saved.scenario}</strong></span>
          <span>Agent <strong>{saved.manifest.agent.slice(0, 8)}…</strong></span>
          <span>Calls <strong>{saved.calls.length}</strong></span>
          <span>Nonce <strong>{saved.manifest.nonce}</strong></span>
        </div>
        <button className="primary" disabled={!isAgent || writer.isPending || receipt.isLoading} onClick={execute}>Execute as signed agent</button>
        <button className="text-button" onClick={() => { localStorage.removeItem("cresnex.signedIntent"); setSaved(null); }}>Clear package</button>
        {!isAgent && <p className="demo-note">Switch the connected wallet to the signed agent address to execute. The owner signature remains stored only in this browser.</p>}
      </>}
      {writer.error && <p className="error-note">Submission failed: {writer.error.message}</p>}
      {receipt.isSuccess && <p className="success-note">Execution transaction confirmed. Check the evidence timeline to see whether it committed or was contained.</p>}
    </section>
  );
}
