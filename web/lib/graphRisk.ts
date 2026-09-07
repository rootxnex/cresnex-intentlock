export const GRAPH_RISK_RULE_ID = "intentlock-agent-violations-24h-v1" as const;
export const GRAPH_RESULT_CAP = 3;
export const RISK_WINDOW_SECONDS = 24n * 60n * 60n;

export type GraphRiskDecision = "ALLOW" | "ESCALATE" | "BLOCK";

export type GraphViolationRecord = {
  timestamp?: unknown;
};

export type GraphRiskResponse = {
  data?: {
    violations?: unknown;
    _meta?: {
      block?: {
        number?: unknown;
      } | null;
      hasIndexingErrors?: unknown;
    } | null;
  } | null;
  errors?: unknown;
};

export type GraphRiskEvaluationInput = {
  response: unknown;
  chainHeadBlock: unknown;
  maxAllowedLag: unknown;
  windowStartTimestamp: unknown;
  evaluationTimestamp: unknown;
};

export type GraphRiskEvaluation = {
  decision: GraphRiskDecision;
  evidenceUsable: boolean;
  recentViolationCount: number | null;
  thresholdReached: boolean;
  ruleId: typeof GRAPH_RISK_RULE_ID;
  graphIndexedBlock: bigint | null;
  chainHeadBlock: bigint | null;
  indexingLag: bigint | null;
  reason: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeInteger(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return null;
}

export function decisionForRecentViolationCount(count: number): GraphRiskDecision {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("recent violation count must be a non-negative safe integer");
  }
  if (count === 0) return "ALLOW";
  if (count < GRAPH_RESULT_CAP) return "ESCALATE";
  return "BLOCK";
}

export function evaluateGraphRisk(input: GraphRiskEvaluationInput): GraphRiskEvaluation {
  const chainHeadBlock = nonNegativeInteger(input.chainHeadBlock);
  const maxAllowedLag = nonNegativeInteger(input.maxAllowedLag);
  const windowStartTimestamp = nonNegativeInteger(input.windowStartTimestamp);
  const evaluationTimestamp = nonNegativeInteger(input.evaluationTimestamp);

  const failClosed = (
    reason: string,
    graphIndexedBlock: bigint | null = null,
    indexingLag: bigint | null = null,
  ): GraphRiskEvaluation => ({
    decision: "BLOCK",
    evidenceUsable: false,
    recentViolationCount: null,
    thresholdReached: false,
    ruleId: GRAPH_RISK_RULE_ID,
    graphIndexedBlock,
    chainHeadBlock,
    indexingLag,
    reason,
  });

  if (chainHeadBlock === null) return failClosed("invalid chain head block");
  if (maxAllowedLag === null) return failClosed("invalid maximum indexing lag");
  if (windowStartTimestamp === null || evaluationTimestamp === null) {
    return failClosed("invalid evaluation window timestamp");
  }
  if (evaluationTimestamp < windowStartTimestamp
    || evaluationTimestamp - windowStartTimestamp !== RISK_WINDOW_SECONDS) {
    return failClosed("evaluation window must be exactly 24 hours");
  }

  const response = object(input.response);
  if (response === null) return failClosed("malformed Graph response");
  if (response.errors !== undefined) {
    if (!Array.isArray(response.errors)) return failClosed("malformed Graph errors collection");
    if (response.errors.length > 0) return failClosed("Graph response contains errors");
  }

  const data = object(response.data);
  if (data === null) return failClosed("missing Graph data");
  const meta = object(data._meta);
  if (meta === null) return failClosed("missing Graph metadata");
  if (meta.hasIndexingErrors !== false) return failClosed("Graph indexing health is not clean");

  const block = object(meta.block);
  if (block === null) return failClosed("missing indexed block");
  const graphIndexedBlock = nonNegativeInteger(block.number);
  if (graphIndexedBlock === null) return failClosed("invalid indexed block number");
  if (graphIndexedBlock > chainHeadBlock) {
    return failClosed("indexed block is ahead of supplied chain head", graphIndexedBlock);
  }

  const indexingLag = chainHeadBlock - graphIndexedBlock;
  if (indexingLag > maxAllowedLag) {
    return failClosed("Graph evidence is stale", graphIndexedBlock, indexingLag);
  }

  if (!Array.isArray(data.violations)) return failClosed("malformed violations collection", graphIndexedBlock, indexingLag);
  if (data.violations.length > GRAPH_RESULT_CAP) {
    return failClosed("violations collection exceeds requested cap", graphIndexedBlock, indexingLag);
  }

  for (const item of data.violations) {
    const violation = object(item) as GraphViolationRecord | null;
    const timestamp = violation === null ? null : nonNegativeInteger(violation.timestamp);
    if (timestamp === null) return failClosed("invalid violation timestamp", graphIndexedBlock, indexingLag);
    if (timestamp < windowStartTimestamp || timestamp > evaluationTimestamp) {
      return failClosed("violation timestamp is outside the requested window", graphIndexedBlock, indexingLag);
    }
  }

  const recentViolationCount = data.violations.length;
  const decision = decisionForRecentViolationCount(recentViolationCount);
  return {
    decision,
    evidenceUsable: true,
    recentViolationCount,
    thresholdReached: recentViolationCount === GRAPH_RESULT_CAP,
    ruleId: GRAPH_RISK_RULE_ID,
    graphIndexedBlock,
    chainHeadBlock,
    indexingLag,
    reason: decision === "ALLOW"
      ? "no recent indexed IntentLock policy violations"
      : decision === "ESCALATE"
        ? "one or two recent indexed IntentLock policy violations"
        : "at least three recent indexed IntentLock policy violations",
  };
}
