"use client";
import { useMemo, useState } from "react";
import { encodeFunctionData, erc20Abi, isAddress, maxUint256, type Address } from "viem";
import { useAccount, useChainId, useSignTypedData } from "wagmi";
import { hashCalls, intentTypes, type ExecutionCall } from "@/lib/intent";

const zero = "0x0000000000000000000000000000000000000000" as Address;
const inputAmount = 100_000_000n;
const outputAmount = 1_000_000_000_000_000_000n;
const routerAbi = [{
  type: "function",
  name: "swap",
  stateMutability: "nonpayable",
  inputs: [
    { name: "input", type: "address" },
    { name: "output", type: "address" },
    { name: "inputAmount", type: "uint256" },
    { name: "outputAmount", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "behavior", type: "uint8" },
  ],
  outputs: [],
}] as const;

const scenarios = {
  custom: "Custom exact call",
  valid: "Valid swap",
  overspend: "Overspending attack",
  insufficient: "Insufficient-output attack",
  recipient: "Wrong-recipient attack",
  allowance: "Unlimited-approval attack",
  batch: "Hidden malicious batch",
  expired: "Expired-intent authentication failure",
} as const;

export function IntentBuilder() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();
  const [agent, setAgent] = useState("");
  const [scenario, setScenario] = useState<keyof typeof scenarios>("valid");
  const [target, setTarget] = useState("");
  const [calldata, setCalldata] = useState("0x");
  const [signature, setSignature] = useState("");
  const account = (process.env.NEXT_PUBLIC_ACCOUNT_ADDRESS || zero) as Address;
  const token = (process.env.NEXT_PUBLIC_USDC_ADDRESS || zero) as Address;
  const output = (process.env.NEXT_PUBLIC_WETH_ADDRESS || zero) as Address;
  const router = (process.env.NEXT_PUBLIC_ROUTER_ADDRESS || zero) as Address;
  const policyRecipient = address || zero;
  const calls = useMemo<ExecutionCall[]>(() => {
    if (scenario === "custom") {
      return isAddress(target)
        ? [{ target, value: 0n, data: calldata.startsWith("0x") ? calldata as `0x${string}` : "0x" }]
        : [];
    }
    if ([token, output, router, policyRecipient].some((item) => item === zero)) return [];
    if (scenario === "allowance") {
      return [{
        target: token,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, maxUint256] }),
      }];
    }
    const behavior = { valid: 0, overspend: 1, insufficient: 2, recipient: 3, batch: 0, expired: 0 }[scenario];
    const approved = scenario === "overspend" ? inputAmount + 1n : inputAmount;
    const swapCalls: ExecutionCall[] = [
      {
        target: token,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, approved] }),
      },
      {
        target: router,
        value: 0n,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: "swap",
          args: [token, output, inputAmount, outputAmount, policyRecipient, behavior],
        }),
      },
    ];
    if (scenario === "batch" && isAddress(agent)) {
      swapCalls.push({
        target: token,
        value: 0n,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [agent, 1n] }),
      });
    }
    return swapCalls;
  }, [scenario, target, calldata, token, output, router, policyRecipient, agent]);
  const callsHash = calls.length ? hashCalls(calls) : null;

  async function sign() {
    if (!address || !isAddress(agent) || !callsHash) return;
    const now = Math.floor(Date.now() / 1000);
    const message = {
      account, agent: agent as Address, chainId: BigInt(chainId), callsHash, inputToken: token,
      maxInputAmount: scenario === "allowance" ? 0n : inputAmount,
      outputToken: output, minOutputAmount: scenario === "allowance" ? 0n : outputAmount,
      recipient: address, approvalToken: token,
      approvalSpender: router, maxFinalAllowance: 0n, nonce: BigInt(now),
      validAfter: scenario === "expired" ? now - 3600 : now,
      validUntil: scenario === "expired" ? now - 1 : now + 3600,
      allowBatch: calls.length > 1,
    };
    const result = await signTypedDataAsync({
      domain: { name: "Cresnex IntentLock", version: "1", chainId, verifyingContract: account },
      types: intentTypes, primaryType: "IntentManifest", message,
    });
    setSignature(result);
    localStorage.setItem(
      "cresnex.signedIntent",
      JSON.stringify({ scenario, manifest: message, calls, ownerSignature: result }, (_, value) =>
        typeof value === "bigint" ? value.toString() : value),
    );
    window.dispatchEvent(new Event("cresnex:intent-signed"));
  }

  return (
    <section className="panel builder" id="builder">
      <div className="eyebrow">Owner workspace</div>
      <h2>Build a bounded intent</h2>
      <p className="muted">Bind one exact call to a spend ceiling, output floor, recipient, allowance cap, nonce and expiry.</p>
      <div className="builder-step"><span>01</span><div><h3>Agent</h3><label>Agent address<input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="0x…" /></label></div></div>
      <div className="builder-step"><span>02</span><div><h3>Execution</h3><label>Test scenario<select value={scenario} onChange={(event) => setScenario(event.target.value as keyof typeof scenarios)}>{Object.entries(scenarios).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{scenario === "custom" && <div className="form-grid"><label>Call target<input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0x…" /></label><label>Complete calldata<input value={calldata} onChange={(e) => setCalldata(e.target.value)} /></label></div>}</div></div>
      <div className="builder-step"><span>03</span><div><h3>Financial boundaries</h3><div className="policy">
        <span>Maximum input <strong>{scenario === "allowance" ? "0" : "100 USDC"}</strong></span><span>Minimum output <strong>{scenario === "allowance" ? "0" : "1 WETH"}</strong></span>
        <span>Final allowance <strong>Exact / 0</strong></span>
      </div></div></div>
      <div className="builder-step"><span>04</span><div><h3>Validity</h3><div className="policy"><span>Expiration <strong>1 hour</strong></span><span>Bound calls <strong>{calls.length}</strong></span><span>Chain <strong>{chainId}</strong></span></div></div></div>
      <div className="builder-step review-step"><span>05</span><div><h3>Review</h3><div className="hash"><span>Canonical calls hash</span><code>{callsHash || "Complete the call to calculate"}</code></div></div></div>
      <button className="primary" disabled={!address || !callsHash || !isAddress(agent)} onClick={sign}>Sign EIP-712 intent</button>
      {signature && <div className="hash success"><span>Owner signature created and saved for the agent wallet</span><code>{signature}</code></div>}
    </section>
  );
}
