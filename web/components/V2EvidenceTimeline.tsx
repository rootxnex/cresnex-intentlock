"use client";

import { useEffect, useState } from "react";
import { useBlockNumber, usePublicClient } from "wagmi";
import { accountV2Abi, accountV2Address, deploymentV2Block } from "@/lib/contracts";
import { policyModuleNames } from "@/lib/intentV2";

const violationNames = [
  "None", "Maximum spend exceeded", "Minimum output not met", "Wrong recipient",
  "Allowance exceeded", "Unauthorized call", "Call order mismatch", "Protected asset loss",
  "NFT not received", "Payment period violation", "Administration value out of range",
  "Policy module failure", "Native spend exceeded",
];

type Item = {
  key: string;
  block: bigint;
  title: string;
  detail: string;
  tone: "ok" | "danger" | "neutral";
  transactionHash?: string;
  intentDigest?: string;
  evidenceHash?: string;
  module?: string;
  strikeCount?: bigint;
  quarantined?: boolean;
};

const short = (value?: string) => value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";

export function V2EvidenceTimeline({ limit = 30, title = "V2 security timeline", compact = false, detailed = false }: { limit?: number; title?: string; compact?: boolean; detailed?: boolean }) {
  const client = usePublicClient();
  const { data: latestBlock } = useBlockNumber({ watch: true });
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!client || !accountV2Address || latestBlock === undefined) return;
    let active = true;
    const load = async () => {
      const fromBlock = deploymentV2Block > 0n
        ? deploymentV2Block
        : latestBlock > 20_000n ? latestBlock - 20_000n : 0n;
      const [executed, violated, failed] = await Promise.all([
        client.getContractEvents({
          address: accountV2Address,
          abi: accountV2Abi,
          eventName: "IntentExecuted",
          fromBlock,
          toBlock: "latest",
        }),
        client.getContractEvents({
          address: accountV2Address,
          abi: accountV2Abi,
          eventName: "IntentViolation",
          fromBlock,
          toBlock: "latest",
        }),
        client.getContractEvents({
          address: accountV2Address,
          abi: accountV2Abi,
          eventName: "ExecutionFailed",
          fromBlock,
          toBlock: "latest",
        }),
      ]);
      if (!active) return;
      const next: Item[] = [
        ...executed.map((log) => {
          const args = log.args as { intentDigest?: string; agent?: string; callsHash?: string };
          return {
            key: `${log.transactionHash}-${log.logIndex}`,
            block: log.blockNumber,
            title: "V2 intent committed",
            detail: `${short(args.agent)} · intent ${short(args.intentDigest)} · calls ${short(args.callsHash)}`,
            tone: "ok" as const,
            transactionHash: log.transactionHash,
            intentDigest: args.intentDigest,
          };
        }),
        ...violated.map((log) => {
          const args = log.args as {
            intentDigest?: string;
            code?: number;
            module?: number;
            evidenceHash?: string;
            strikeCount?: bigint;
            quarantined?: boolean;
          };
          return {
            key: `${log.transactionHash}-${log.logIndex}`,
            block: log.blockNumber,
            title: violationNames[Number(args.code ?? 11)] ?? "Unknown policy violation",
            detail: `${policyModuleNames[Number(args.module ?? 0)] ?? "Unknown module"} · evidence ${short(args.evidenceHash)} · strike ${args.strikeCount ?? "—"}${args.quarantined ? " · quarantined" : ""}`,
            tone: "danger" as const,
            transactionHash: log.transactionHash,
            intentDigest: args.intentDigest,
            evidenceHash: args.evidenceHash,
            module: policyModuleNames[Number(args.module ?? 0)] ?? "Unknown module",
            strikeCount: args.strikeCount,
            quarantined: args.quarantined,
          };
        }),
        ...failed.map((log) => {
          const args = log.args as { agent?: string; failureHash?: string };
          return {
            key: `${log.transactionHash}-${log.logIndex}`,
            block: log.blockNumber,
            title: "External target failed without strike",
            detail: `${short(args.agent)} · failure ${short(args.failureHash)}`,
            tone: "neutral" as const,
            transactionHash: log.transactionHash,
          };
        }),
      ].sort((a, b) => a.block === b.block ? 0 : a.block > b.block ? -1 : 1);
      setItems(next.slice(0, limit));
      setError("");
    };
    load().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message.split("\n")[0] : "Event query failed");
    });
    return () => { active = false; };
  }, [client, latestBlock, limit]);

  return (
    <section className={`panel events${compact ? " compact-events" : ""}${detailed ? " forensic-events" : ""}`} id="v2-events">
      <div className="panel-number">V2 / EVIDENCE</div>
      <div className="eyebrow">Decoded persistent outcomes</div>
      <h2>{title}</h2>
      {!accountV2Address && <div className="empty">Connect a verified V2 deployment to load live evidence. The deployment setup panel lists the required public configuration.</div>}
      {accountV2Address && items.length === 0 && !error && <div className="empty">No v2 events in the configured scan window.</div>}
      {error && <p className="error-note">{error}</p>}
      {items.map((item) => <div className="event" key={item.key}>
        <time>Block {item.block.toString()}</time>
        <span className="event-icon">{item.tone === "ok" ? "✓" : item.tone === "danger" ? "!" : "↺"}</span>
        <div><strong>{item.title}</strong><p>{item.detail}</p>{detailed && <dl className="event-evidence">
          {item.intentDigest && <div><dt>Intent digest</dt><dd title={item.intentDigest}>{short(item.intentDigest)}</dd></div>}
          {item.module && <div><dt>Module</dt><dd>{item.module}</dd></div>}
          {item.evidenceHash && <div><dt>Evidence hash</dt><dd title={item.evidenceHash}>{short(item.evidenceHash)}</dd></div>}
          {item.strikeCount !== undefined && <div><dt>Strike count</dt><dd>{item.strikeCount.toString()}</dd></div>}
          {item.quarantined !== undefined && <div><dt>Quarantine</dt><dd>{item.quarantined ? "Yes" : "No"}</dd></div>}
          <div><dt>Block</dt><dd>{item.block.toString()}</dd></div>
        </dl>}{detailed && item.transactionHash && <a className="event-link" href={`https://sepolia.basescan.org/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">View transaction {short(item.transactionHash)} ↗</a>}</div>
      </div>)}
    </section>
  );
}
