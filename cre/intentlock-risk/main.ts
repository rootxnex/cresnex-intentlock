import {
  consensusIdenticalAggregation, decodeJson, EVMClient, handler, HTTPCapability, HTTPClient,
  type HTTPPayload, prepareReportRequest, protoBigIntToBigint,
  Runner, type Runtime, TxStatus,
} from "@chainlink/cre-sdk";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { fetchGraphEvidence, parseGraphEvidence, transactionHashes } from "./graph";
import { parseIntentBindings } from "./input";
import { evaluateGraphRisk, RISK_WINDOW_SECONDS, type RiskEvaluation } from "./risk";
import { buildRiskVerdict, encodeRiskVerdict } from "./verdict";

const BASE_SEPOLIA_SELECTOR = EVMClient.SUPPORTED_CHAIN_SELECTORS["ethereum-testnet-sepolia-base-1"];
const RECEIVER_EXECUTION_SUCCESS = 0;
export type Config = {
  graphEndpoint: string; maxAllowedLag: string; validitySeconds: string;
  receiverAddress: Address; writeGasLimit: string;
};
export type SimulationOutput = {
  version: 1; decision: RiskEvaluation["decision"]; recentViolationCount: number;
  evidenceUsable: boolean; thresholdReached: boolean; evidenceHash: string;
  reportGenerated: boolean; reportPayloadLength: number; graphIndexedBlock: string;
  chainHeadBlock: string; indexingLag: string; issuedAt: string; validUntil: string;
  writeReportSucceeded: boolean; writeTxStatus: number; receiverExecutionStatus: number;
};

function configuredReceiver(config: Config): Address {
  if (!isAddress(config.receiverAddress, { strict: false })) throw new TypeError("invalid receiverAddress");
  const receiver = getAddress(config.receiverAddress);
  if (receiver === zeroAddress) throw new RangeError("receiverAddress is not configured");
  return receiver;
}

export const onHTTPTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): SimulationOutput => {
  const bindings = parseIntentBindings(decodeJson(payload.input));
  const receiver = configuredReceiver(runtime.config);
  const evaluationTimestamp = BigInt(Math.floor(runtime.now().getTime() / 1_000));
  const windowStart = evaluationTimestamp - RISK_WINDOW_SECONDS;
  let chainHeadBlock: bigint | null = null;
  let evaluation: RiskEvaluation;
  try {
    const latest = new EVMClient(BASE_SEPOLIA_SELECTOR).headerByNumber(runtime, {}).result();
    if (latest.header?.blockNumber === undefined) throw new Error("missing Base Sepolia block number");
    chainHeadBlock = protoBigIntToBigint(latest.header.blockNumber);
    const raw = new HTTPClient().sendRequest(
      runtime, fetchGraphEvidence, consensusIdenticalAggregation<string>(),
    )({
      endpoint: runtime.config.graphEndpoint,
      agent: bindings.agent,
      windowStart: windowStart.toString(),
    }).result();
    const graphResponse = parseGraphEvidence(raw);
    evaluation = evaluateGraphRisk({
      response: graphResponse, chainHeadBlock, maxAllowedLag: runtime.config.maxAllowedLag,
      windowStart, evaluationTimestamp,
    });
    runtime.log(`Graph transaction hashes: ${JSON.stringify(transactionHashes(graphResponse))}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown operational evidence failure";
    evaluation = {
      decision: "BLOCK", evidenceUsable: false, recentViolationCount: null,
      thresholdReached: false, graphIndexedBlock: null, chainHeadBlock, indexingLag: null,
      reason: `operational evidence failure: ${reason}`,
    };
  }

  const verdict = buildRiskVerdict({
    evaluation, bindings, windowStart, issuedAt: evaluationTimestamp,
    validitySeconds: BigInt(runtime.config.validitySeconds),
  });
  const encodedVerdict = encodeRiskVerdict(verdict);
  const report = runtime.report(prepareReportRequest(encodedVerdict)).result();
  const write = new EVMClient(BASE_SEPOLIA_SELECTOR).writeReport(runtime, {
    receiver,
    report,
    gasConfig: { gasLimit: BigInt(runtime.config.writeGasLimit) },
  }).result();
  if (write.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`writeReport transaction failed: ${write.errorMessage || write.txStatus}`);
  }
  if (write.receiverContractExecutionStatus !== RECEIVER_EXECUTION_SUCCESS) {
    throw new Error(`receiver execution failed: ${write.receiverContractExecutionStatus}`);
  }
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
    writeReportSucceeded: true, writeTxStatus: write.txStatus,
    receiverExecutionStatus: write.receiverContractExecutionStatus,
  };
  runtime.log(`IntentLock CRE verdict delivery simulation: ${JSON.stringify(result)}`);
  return result;
};

export const initWorkflow = (_config: Config) => [handler(new HTTPCapability().trigger({}), onHTTPTrigger)];
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
