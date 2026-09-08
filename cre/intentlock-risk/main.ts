import {
  consensusIdenticalAggregation, CronCapability, EVMClient, handler, HTTPClient,
  prepareReportRequest, protoBigIntToBigint, Runner, type Runtime,
} from "@chainlink/cre-sdk";
import type { Address, Hex } from "viem";
import { fetchGraphEvidence, parseGraphEvidence, transactionHashes } from "./graph";
import { evaluateGraphRisk, RISK_WINDOW_SECONDS, type RiskEvaluation } from "./risk";
import { buildRiskVerdict, encodeRiskVerdict } from "./verdict";

const BASE_SEPOLIA_SELECTOR = EVMClient.SUPPORTED_CHAIN_SELECTORS["ethereum-testnet-sepolia-base-1"];
export type Config = {
  schedule: string; graphEndpoint: string; agent: Address; maxAllowedLag: string;
  account: Address; nonce: string; callsHash: Hex; policyHash: Hex; validitySeconds: string;
};
export type SimulationOutput = {
  version: 1; decision: RiskEvaluation["decision"]; recentViolationCount: number;
  evidenceUsable: boolean; thresholdReached: boolean; evidenceHash: string;
  reportGenerated: boolean; reportPayloadLength: number; graphIndexedBlock: string;
  chainHeadBlock: string; indexingLag: string; issuedAt: string; validUntil: string;
};

export const onCronTrigger = (runtime: Runtime<Config>): SimulationOutput => {
  const evaluationTimestamp = BigInt(Math.floor(runtime.now().getTime() / 1_000));
  const windowStart = evaluationTimestamp - RISK_WINDOW_SECONDS;
  let chainHeadBlock: bigint | null = null;
  try {
    const latest = new EVMClient(BASE_SEPOLIA_SELECTOR).headerByNumber(runtime, {}).result();
    if (latest.header?.blockNumber === undefined) throw new Error("missing Base Sepolia block number");
    chainHeadBlock = protoBigIntToBigint(latest.header.blockNumber);
    const raw = new HTTPClient().sendRequest(
      runtime, fetchGraphEvidence, consensusIdenticalAggregation<string>(),
    )({
      endpoint: runtime.config.graphEndpoint,
      agent: runtime.config.agent,
      windowStart: windowStart.toString(),
    }).result();
    const graphResponse = parseGraphEvidence(raw);
    const evaluation = evaluateGraphRisk({
      response: graphResponse, chainHeadBlock, maxAllowedLag: runtime.config.maxAllowedLag,
      windowStart, evaluationTimestamp,
    });
    runtime.log(`Graph transaction hashes: ${JSON.stringify(transactionHashes(graphResponse))}`);
    const verdict = buildRiskVerdict({
      evaluation,
      bindings: {
        account: runtime.config.account, agent: runtime.config.agent,
        nonce: BigInt(runtime.config.nonce), callsHash: runtime.config.callsHash,
        policyHash: runtime.config.policyHash,
      },
      windowStart, issuedAt: evaluationTimestamp,
      validitySeconds: BigInt(runtime.config.validitySeconds),
    });
    const encodedVerdict = encodeRiskVerdict(verdict);
    const report = runtime.report(prepareReportRequest(encodedVerdict)).result();
    const result: SimulationOutput = {
      version: verdict.version, decision: verdict.decision,
      recentViolationCount: verdict.recentViolationCount,
      evidenceUsable: verdict.evidenceUsable, thresholdReached: verdict.thresholdReached,
      evidenceHash: verdict.evidenceHash, reportGenerated: report.rawReport().length > 0,
      reportPayloadLength: (encodedVerdict.length - 2) / 2,
      graphIndexedBlock: verdict.graphIndexedBlock.toString(),
      chainHeadBlock: evaluation.chainHeadBlock?.toString() ?? "unavailable",
      indexingLag: evaluation.indexingLag?.toString() ?? "unavailable",
      issuedAt: verdict.issuedAt.toString(), validUntil: verdict.validUntil.toString(),
    };
    runtime.log(`IntentLock CRE verdict report: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown operational evidence failure";
    const evaluation: RiskEvaluation = {
      decision: "BLOCK", evidenceUsable: false, recentViolationCount: null,
      thresholdReached: false, graphIndexedBlock: null, chainHeadBlock, indexingLag: null,
      reason: `operational evidence failure: ${reason}`,
    };
    const verdict = buildRiskVerdict({
      evaluation,
      bindings: {
        account: runtime.config.account, agent: runtime.config.agent,
        nonce: BigInt(runtime.config.nonce), callsHash: runtime.config.callsHash,
        policyHash: runtime.config.policyHash,
      },
      windowStart, issuedAt: evaluationTimestamp,
      validitySeconds: BigInt(runtime.config.validitySeconds),
    });
    const encodedVerdict = encodeRiskVerdict(verdict);
    const report = runtime.report(prepareReportRequest(encodedVerdict)).result();
    const result: SimulationOutput = {
      version: verdict.version, decision: verdict.decision,
      recentViolationCount: verdict.recentViolationCount,
      evidenceUsable: verdict.evidenceUsable, thresholdReached: verdict.thresholdReached,
      evidenceHash: verdict.evidenceHash, reportGenerated: report.rawReport().length > 0,
      reportPayloadLength: (encodedVerdict.length - 2) / 2,
      graphIndexedBlock: verdict.graphIndexedBlock.toString(),
      chainHeadBlock: evaluation.chainHeadBlock?.toString() ?? "unavailable",
      indexingLag: evaluation.indexingLag?.toString() ?? "unavailable",
      issuedAt: verdict.issuedAt.toString(), validUntil: verdict.validUntil.toString(),
    };
    runtime.log(`IntentLock CRE fail-closed verdict report: ${JSON.stringify(result)}`);
    return result;
  }
};

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCronTrigger),
];
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
