"use client";

import { useEffect, useMemo, useState } from "react";
import { type Address, isAddress } from "viem";
import {
  useAccount,
  useBlockNumber,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { accountAbi, accountAddress, deploymentBlock } from "@/lib/contracts";

type TimelineItem = {
  key: string;
  block: bigint;
  title: string;
  detail: string;
  tone: "ok" | "danger" | "neutral";
};

const short = (value?: string) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";

export function AccountConsole() {
  const { address, chain } = useAccount();
  const client = usePublicClient();
  const { data: latestBlock } = useBlockNumber({ watch: true });
  const [agent, setAgent] = useState("");
  const [threshold, setThreshold] = useState("3");
  const [events, setEvents] = useState<TimelineItem[]>([]);
  const configured = Boolean(accountAddress);

  const reads = useReadContracts({
    allowFailure: true,
    contracts: accountAddress ? [
      { address: accountAddress, abi: accountAbi, functionName: "owner" },
      { address: accountAddress, abi: accountAbi, functionName: "paused" },
      { address: accountAddress, abi: accountAbi, functionName: "quarantineThreshold" },
    ] : [],
    query: { enabled: configured, refetchInterval: 4_000 },
  });
  const owner = reads.data?.[0]?.result as Address | undefined;
  const paused = reads.data?.[1]?.result as boolean | undefined;
  const quarantineThreshold = reads.data?.[2]?.result as bigint | undefined;
  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());

  const selectedAgent = isAddress(agent) ? agent as Address : undefined;
  const agentState = useReadContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: "agents",
    args: selectedAgent ? [selectedAgent] : undefined,
    query: { enabled: Boolean(accountAddress && selectedAgent), refetchInterval: 3_000 },
  });
  const state = agentState.data as readonly [boolean, boolean, bigint] | undefined;

  const writer = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: writer.data });
  const busy = writer.isPending || receipt.isLoading;

  function write(functionName: string, args: readonly unknown[] = []) {
    if (!accountAddress) return;
    writer.writeContract({ address: accountAddress, abi: accountAbi, functionName, args });
  }

  useEffect(() => {
    if (!client || !accountAddress || latestBlock === undefined) return;
    let active = true;
    const load = async () => {
      const fromBlock = deploymentBlock > 0n
        ? deploymentBlock
        : latestBlock > 20_000n ? latestBlock - 20_000n : 0n;
      const [executed, violated, quarantined, recovered] = await Promise.all([
        client.getContractEvents({ address: accountAddress, abi: accountAbi, eventName: "IntentExecuted", fromBlock, toBlock: "latest" }),
        client.getContractEvents({ address: accountAddress, abi: accountAbi, eventName: "IntentViolation", fromBlock, toBlock: "latest" }),
        client.getContractEvents({ address: accountAddress, abi: accountAbi, eventName: "AgentQuarantined", fromBlock, toBlock: "latest" }),
        client.getContractEvents({ address: accountAddress, abi: accountAbi, eventName: "AgentRecovered", fromBlock, toBlock: "latest" }),
      ]);
      if (!active) return;
      const items: TimelineItem[] = [
        ...executed.map((log) => {
          const args = log.args as { intentHash?: string; agent?: string };
          return { key: `${log.transactionHash}-ok`, block: log.blockNumber, title: "Intent executed safely", detail: `${short(args.agent)} · ${short(args.intentHash)}`, tone: "ok" as const };
        }),
        ...violated.map((log) => {
          const args = log.args as { evidenceHash?: string; reasonSelector?: string; strikeCount?: bigint };
          return { key: `${log.transactionHash}-violation`, block: log.blockNumber, title: "Outcome violation persisted", detail: `Evidence ${short(args.evidenceHash)} · reason ${args.reasonSelector ?? "—"} · strike ${args.strikeCount ?? "—"}`, tone: "danger" as const };
        }),
        ...quarantined.map((log) => {
          const args = log.args as { agent?: string; strikeCount?: bigint };
          return { key: `${log.transactionHash}-quarantine`, block: log.blockNumber, title: "Agent quarantined", detail: `${short(args.agent)} at strike ${args.strikeCount ?? "—"}`, tone: "danger" as const };
        }),
        ...recovered.map((log) => {
          const args = log.args as { agent?: string };
          return { key: `${log.transactionHash}-recovered`, block: log.blockNumber, title: "Owner recovery completed", detail: short(args.agent), tone: "neutral" as const };
        }),
      ].sort((a, b) => a.block === b.block ? 0 : a.block > b.block ? -1 : 1);
      setEvents(items.slice(0, 20));
    };
    load().catch(() => setEvents([]));
    return () => { active = false; };
  }, [client, latestBlock]);

  const status = useMemo(() => {
    if (!configured) return "Not configured";
    if (paused === undefined) return "Loading";
    return paused ? "Paused" : "Protected execution active";
  }, [configured, paused]);

  return (
    <>
      <section className="stats">
        <article><span>Account</span><strong>{short(accountAddress)}</strong><small>{configured ? "Configured deployment" : "Set NEXT_PUBLIC_ACCOUNT_ADDRESS"}</small></article>
        <article><span>Owner</span><strong>{short(owner)}</strong><small>{isOwner ? "Connected as owner" : "Read from chain"}</small></article>
        <article><span>Network</span><strong>{chain?.name ?? "Not connected"}</strong><small>{chain ? `Chain ID ${chain.id}` : "Connect a wallet"}</small></article>
        <article><span>Protection</span><strong className={paused ? "" : "green"}>{status}</strong><small>Threshold {quarantineThreshold?.toString() ?? "—"}</small></article>
      </section>

      <section className="panel" id="agents">
        <div className="eyebrow">Live owner controls</div>
        <h2>Agent management</h2>
        <div className="form-grid">
          <label className="wide">Agent address<input value={agent} onChange={(event) => setAgent(event.target.value)} placeholder="0x…" /></label>
          <label>Quarantine threshold<input type="number" min="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
        </div>
        <div className="policy">
          <span>Registered <strong>{state ? (state[0] ? "Yes" : "No") : "—"}</strong></span>
          <span>Quarantined <strong>{state ? (state[1] ? "Yes" : "No") : "—"}</strong></span>
          <span>Strikes <strong>{state?.[2]?.toString() ?? "—"}</strong></span>
        </div>
        <div className="control-row">
          <button disabled={!isOwner || !selectedAgent || busy} onClick={() => write("registerAgent", [selectedAgent])}>Register</button>
          <button disabled={!isOwner || !selectedAgent || busy} onClick={() => write("removeAgent", [selectedAgent])}>Remove</button>
          <button disabled={!isOwner || !selectedAgent || busy} onClick={() => write("resetAgentStrikes", [selectedAgent])}>Reset strikes</button>
          <button disabled={!isOwner || !selectedAgent || busy} onClick={() => write("unquarantineAgent", [selectedAgent])}>Unquarantine</button>
          <button disabled={!isOwner || busy} onClick={() => write(paused ? "unpause" : "pause")}>{paused ? "Unpause" : "Pause"}</button>
          <button disabled={!isOwner || busy || Number(threshold) < 1} onClick={() => write("setQuarantineThreshold", [BigInt(threshold)])}>Set threshold</button>
        </div>
        {writer.error && <p className="error-note">Wallet action failed: {writer.error.message}</p>}
        {receipt.isSuccess && <p className="success-note">Transaction confirmed in block {receipt.data.blockNumber.toString()}.</p>}
        {!isOwner && configured && <p className="demo-note">Connect the account owner to enable recovery and policy controls.</p>}
      </section>

      <section className="panel events" id="events">
        <div className="eyebrow">Persistent onchain evidence</div>
        <h2>Security timeline</h2>
        {events.map((item) => (
          <div className="event" key={item.key}>
            <time>Block {item.block.toString()}</time>
            <span className="event-icon">{item.tone === "ok" ? "✓" : item.tone === "danger" ? "!" : "↺"}</span>
            <div><strong>{item.title}</strong><p>{item.detail}</p></div>
          </div>
        ))}
        {configured && events.length === 0 && <div className="empty">No security events found in the configured scan window.</div>}
        {!configured && <div className="empty">Configure a deployment to load live events.</div>}
      </section>
    </>
  );
}
