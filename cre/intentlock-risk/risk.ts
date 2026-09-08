export const GRAPH_RISK_RULE_ID = "intentlock-agent-violations-24h-v1" as const;
export const GRAPH_RISK_SIGNAL = "recent indexed IntentLock policy violations" as const;
export const GRAPH_RESULT_CAP = 3;
export const RISK_WINDOW_SECONDS = 86_400n;
export type RiskDecision = "ALLOW" | "ESCALATE" | "BLOCK";
export type RiskEvaluation = {
  decision: RiskDecision; evidenceUsable: boolean; recentViolationCount: number | null;
  thresholdReached: boolean; graphIndexedBlock: bigint | null; chainHeadBlock: bigint | null;
  indexingLag: bigint | null; reason: string;
};
export type RiskEvaluationInput = {
  response: unknown; chainHeadBlock: unknown; maxAllowedLag: unknown;
  windowStart: unknown; evaluationTimestamp: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function uint(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}
export function decisionForCount(count: number): RiskDecision {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("invalid violation count");
  if (count === 0) return "ALLOW";
  if (count < GRAPH_RESULT_CAP) return "ESCALATE";
  return "BLOCK";
}

export function evaluateGraphRisk(input: RiskEvaluationInput): RiskEvaluation {
  const chainHeadBlock = uint(input.chainHeadBlock);
  const maxAllowedLag = uint(input.maxAllowedLag);
  const windowStart = uint(input.windowStart);
  const evaluationTimestamp = uint(input.evaluationTimestamp);
  const fail = (reason: string, graphIndexedBlock: bigint | null = null, indexingLag: bigint | null = null): RiskEvaluation => ({
    decision: "BLOCK", evidenceUsable: false, recentViolationCount: null, thresholdReached: false,
    graphIndexedBlock, chainHeadBlock, indexingLag, reason,
  });
  if (chainHeadBlock === null) return fail("invalid chain head block");
  if (maxAllowedLag === null) return fail("invalid maximum indexing lag");
  if (windowStart === null || evaluationTimestamp === null || evaluationTimestamp < windowStart
    || evaluationTimestamp - windowStart !== RISK_WINDOW_SECONDS) return fail("evaluation window must be exactly 24 hours");
  const response = record(input.response);
  if (response === null) return fail("malformed Graph response");
  if (response.errors !== undefined) {
    if (!Array.isArray(response.errors)) return fail("malformed Graph errors collection");
    if (response.errors.length > 0) return fail("Graph response contains errors");
  }
  const data = record(response.data);
  if (data === null) return fail("missing Graph data");
  const meta = record(data._meta);
  if (meta === null) return fail("missing Graph metadata");
  if (meta.hasIndexingErrors !== false) return fail("Graph indexing health is not clean");
  const block = record(meta.block);
  if (block === null) return fail("missing indexed block");
  const graphIndexedBlock = uint(block.number);
  if (graphIndexedBlock === null) return fail("invalid indexed block number");
  if (graphIndexedBlock > chainHeadBlock) return fail("indexed block is ahead of chain head", graphIndexedBlock);
  const indexingLag = chainHeadBlock - graphIndexedBlock;
  if (indexingLag > maxAllowedLag) return fail("Graph evidence is stale", graphIndexedBlock, indexingLag);
  if (!Array.isArray(data.violations)) return fail("malformed violations collection", graphIndexedBlock, indexingLag);
  if (data.violations.length > GRAPH_RESULT_CAP) return fail("violations collection exceeds query cap", graphIndexedBlock, indexingLag);
  for (const value of data.violations) {
    const violation = record(value);
    const timestamp = violation === null ? null : uint(violation.timestamp);
    if (timestamp === null) return fail("invalid violation timestamp", graphIndexedBlock, indexingLag);
    if (timestamp < windowStart || timestamp > evaluationTimestamp) {
      return fail("violation timestamp is outside the 24-hour window", graphIndexedBlock, indexingLag);
    }
  }
  const recentViolationCount = data.violations.length;
  const decision = decisionForCount(recentViolationCount);
  return {
    decision, evidenceUsable: true, recentViolationCount,
    thresholdReached: recentViolationCount === GRAPH_RESULT_CAP,
    graphIndexedBlock, chainHeadBlock, indexingLag,
    reason: decision === "ALLOW" ? "no recent indexed IntentLock policy violations"
      : decision === "ESCALATE" ? "one or two recent indexed IntentLock policy violations"
        : "at least three recent indexed IntentLock policy violations",
  };
}
