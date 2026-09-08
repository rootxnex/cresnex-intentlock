import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import {
  GRAPH_RISK_RULE_ID,
  GRAPH_RISK_SIGNAL,
  type RiskDecision,
  type RiskEvaluation,
} from "./risk";

export const VERDICT_VERSION = 1 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84_532n;

export type VerdictBindings = {
  account: Address;
  agent: Address;
  nonce: bigint;
  callsHash: Hex;
  policyHash: Hex;
};

export type RiskVerdict = {
  version: typeof VERDICT_VERSION;
  decision: RiskDecision;
  ruleId: typeof GRAPH_RISK_RULE_ID;
  account: Address;
  chainId: bigint;
  agent: Address;
  nonce: bigint;
  callsHash: Hex;
  policyHash: Hex;
  recentViolationCount: number;
  graphIndexedBlock: bigint;
  windowStart: bigint;
  issuedAt: bigint;
  validUntil: bigint;
  evidenceUsable: boolean;
  thresholdReached: boolean;
  evidenceHash: Hex;
};

const EVIDENCE_ABI = [
  { type: "uint8" }, { type: "string" }, { type: "string" }, { type: "address" },
  { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" },
  { type: "bytes32" }, { type: "uint8" }, { type: "uint8" }, { type: "uint256" },
  { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" },
  { type: "bool" },
] as const;

const VERDICT_ABI = [
  { type: "uint8" }, { type: "uint8" }, { type: "string" }, { type: "address" },
  { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" },
  { type: "bytes32" }, { type: "uint8" }, { type: "uint256" }, { type: "uint256" },
  { type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "bool" },
  { type: "bytes32" },
] as const;

export const VERDICT_FIELD_ORDER = [
  "version", "decision", "ruleId", "account", "chainId", "agent", "nonce", "callsHash",
  "policyHash", "recentViolationCount", "graphIndexedBlock", "windowStart", "issuedAt",
  "validUntil", "evidenceUsable", "thresholdReached", "evidenceHash",
] as const;

function decisionCode(decision: RiskDecision): number {
  if (decision === "ALLOW") return 0;
  if (decision === "ESCALATE") return 1;
  return 2;
}

export function buildRiskVerdict(args: {
  evaluation: RiskEvaluation;
  bindings: VerdictBindings;
  windowStart: bigint;
  issuedAt: bigint;
  validitySeconds: bigint;
  chainId?: bigint;
}): RiskVerdict {
  if (!args.evaluation.evidenceUsable
    && (args.evaluation.decision !== "BLOCK" || args.evaluation.thresholdReached)) {
    throw new Error("unusable evidence may only produce a fail-closed BLOCK");
  }
  if (args.evaluation.evidenceUsable
    && ((args.evaluation.decision === "BLOCK") !== args.evaluation.thresholdReached)) {
    throw new Error("usable BLOCK must represent the three-violation threshold");
  }
  if (args.validitySeconds <= 0n) throw new RangeError("validitySeconds must be positive");
  const validUntil = args.issuedAt + args.validitySeconds;
  if (validUntil <= args.issuedAt) throw new RangeError("validUntil must be after issuedAt");
  const chainId = args.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  if (chainId <= 0n) throw new RangeError("chainId must be positive");
  const recentViolationCount = args.evaluation.recentViolationCount ?? 0;
  const graphIndexedBlock = args.evaluation.graphIndexedBlock ?? 0n;
  const evidencePreimage = encodeAbiParameters(EVIDENCE_ABI, [
    VERDICT_VERSION, GRAPH_RISK_RULE_ID, GRAPH_RISK_SIGNAL, args.bindings.account, chainId,
    args.bindings.agent, args.bindings.nonce, args.bindings.callsHash, args.bindings.policyHash,
    decisionCode(args.evaluation.decision), recentViolationCount, graphIndexedBlock,
    args.windowStart, args.issuedAt, validUntil, args.evaluation.evidenceUsable,
    args.evaluation.thresholdReached,
  ]);
  return {
    version: VERDICT_VERSION,
    decision: args.evaluation.decision,
    ruleId: GRAPH_RISK_RULE_ID,
    account: args.bindings.account,
    chainId,
    agent: args.bindings.agent,
    nonce: args.bindings.nonce,
    callsHash: args.bindings.callsHash,
    policyHash: args.bindings.policyHash,
    recentViolationCount,
    graphIndexedBlock,
    windowStart: args.windowStart,
    issuedAt: args.issuedAt,
    validUntil,
    evidenceUsable: args.evaluation.evidenceUsable,
    thresholdReached: args.evaluation.thresholdReached,
    evidenceHash: keccak256(evidencePreimage),
  };
}

export function encodeRiskVerdict(verdict: RiskVerdict): Hex {
  return encodeAbiParameters(VERDICT_ABI, [
    verdict.version, decisionCode(verdict.decision), verdict.ruleId, verdict.account,
    verdict.chainId, verdict.agent, verdict.nonce, verdict.callsHash, verdict.policyHash,
    verdict.recentViolationCount, verdict.graphIndexedBlock, verdict.windowStart,
    verdict.issuedAt, verdict.validUntil, verdict.evidenceUsable, verdict.thresholdReached,
    verdict.evidenceHash,
  ]);
}
