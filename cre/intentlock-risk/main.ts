import {
  consensusIdenticalAggregation, CronCapability, EVMClient, handler, HTTPClient,
  protoBigIntToBigint, Runner, type Runtime,
} from "@chainlink/cre-sdk";
import { fetchGraphEvidence, parseGraphEvidence, transactionHashes } from "./graph";
import {
  evaluateGraphRisk, GRAPH_RISK_RULE_ID, GRAPH_RISK_SIGNAL, RISK_WINDOW_SECONDS,
  type RiskEvaluation,
} from "./risk";

const BASE_SEPOLIA_SELECTOR = EVMClient.SUPPORTED_CHAIN_SELECTORS["ethereum-testnet-sepolia-base-1"];
export type Config = { schedule: string; graphEndpoint: string; agent: string; maxAllowedLag: string };
export type SimulationOutput = {
  version: 1; ruleId: typeof GRAPH_RISK_RULE_ID; signal: typeof GRAPH_RISK_SIGNAL;
  agent: string; decision: RiskEvaluation["decision"]; evidenceUsable: boolean;
  recentViolationCount: number; thresholdReached: boolean;
  graphIndexedBlock: string; chainHeadBlock: string; indexingLag: string;
  windowStart: string; evaluationTimestamp: string; reason: string;
};

function output(agent: string, evaluation: RiskEvaluation, windowStart: bigint, evaluationTimestamp: bigint): SimulationOutput {
  return {
    version: 1, ruleId: GRAPH_RISK_RULE_ID, signal: GRAPH_RISK_SIGNAL, agent,
    decision: evaluation.decision, evidenceUsable: evaluation.evidenceUsable,
    recentViolationCount: evaluation.recentViolationCount ?? -1, thresholdReached: evaluation.thresholdReached,
    graphIndexedBlock: evaluation.graphIndexedBlock?.toString() ?? "unavailable",
    chainHeadBlock: evaluation.chainHeadBlock?.toString() ?? "unavailable",
    indexingLag: evaluation.indexingLag?.toString() ?? "unavailable",
    windowStart: windowStart.toString(), evaluationTimestamp: evaluationTimestamp.toString(),
    reason: evaluation.reason,
  };
}

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
    const result = output(runtime.config.agent, evaluation, windowStart, evaluationTimestamp);
    runtime.log(`IntentLock Graph risk result: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown operational evidence failure";
    const evaluation: RiskEvaluation = {
      decision: "BLOCK", evidenceUsable: false, recentViolationCount: null,
      thresholdReached: false, graphIndexedBlock: null, chainHeadBlock, indexingLag: null,
      reason: `operational evidence failure: ${reason}`,
    };
    const result = output(runtime.config.agent, evaluation, windowStart, evaluationTimestamp);
    runtime.log(`IntentLock Graph risk result: ${JSON.stringify(result)}`);
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
