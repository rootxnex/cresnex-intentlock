import assert from "node:assert/strict";
import test from "node:test";
import {
  decisionForRecentViolationCount,
  evaluateGraphRisk,
  GRAPH_RISK_RULE_ID,
  type GraphRiskEvaluationInput,
} from "./graphRisk.ts";

const head = 46_500_000n;
const now = 1_800_000_000n;
const windowStart = now - 86_400n;

function response(count: number, options: {
  indexedBlock?: unknown;
  hasIndexingErrors?: unknown;
  timestamp?: unknown;
} = {}): unknown {
  return {
    data: {
      violations: Array.from({ length: count }, () => ({
        timestamp: options.timestamp ?? now.toString(),
      })),
      _meta: {
        block: { number: options.indexedBlock ?? head.toString() },
        hasIndexingErrors: options.hasIndexingErrors ?? false,
      },
    },
  };
}

function input(graphResponse: unknown, overrides: Partial<GraphRiskEvaluationInput> = {}): GraphRiskEvaluationInput {
  return {
    response: graphResponse,
    chainHeadBlock: head,
    maxAllowedLag: 20n,
    windowStartTimestamp: windowStart,
    evaluationTimestamp: now,
    ...overrides,
  };
}

test("decision boundaries are deterministic", () => {
  assert.equal(decisionForRecentViolationCount(0), "ALLOW");
  assert.equal(decisionForRecentViolationCount(1), "ESCALATE");
  assert.equal(decisionForRecentViolationCount(2), "ESCALATE");
  assert.equal(decisionForRecentViolationCount(3), "BLOCK");
  assert.equal(decisionForRecentViolationCount(4), "BLOCK");
  assert.equal(decisionForRecentViolationCount(10_000), "BLOCK");
});

test("invalid direct counts are rejected", () => {
  assert.throws(() => decisionForRecentViolationCount(-1), /non-negative/);
  assert.throws(() => decisionForRecentViolationCount(1.5), /safe integer/);
  assert.throws(() => decisionForRecentViolationCount(Number.NaN), /safe integer/);
});

test("currently proven one-violation state evaluates to ESCALATE", () => {
  const result = evaluateGraphRisk(input(response(1)));
  assert.deepEqual(
    { decision: result.decision, count: result.recentViolationCount, usable: result.evidenceUsable },
    { decision: "ESCALATE", count: 1, usable: true },
  );
  assert.equal(result.ruleId, GRAPH_RISK_RULE_ID);
  assert.match(result.reason, /recent indexed IntentLock policy violations/);
});

test("validated capped records map to ALLOW, ESCALATE, and BLOCK", () => {
  assert.equal(evaluateGraphRisk(input(response(0))).decision, "ALLOW");
  assert.equal(evaluateGraphRisk(input(response(2))).decision, "ESCALATE");
  const blocked = evaluateGraphRisk(input(response(3)));
  assert.equal(blocked.decision, "BLOCK");
  assert.equal(blocked.thresholdReached, true);
  assert.match(blocked.reason, /at least three/);
});

test("three capped records mean threshold reached, not exactly three lifetime violations", () => {
  const result = evaluateGraphRisk(input(response(3)));
  assert.equal(result.recentViolationCount, 3);
  assert.equal(result.thresholdReached, true);
  assert.equal(result.decision, "BLOCK");
});

test("freshness accepts head, permitted lag, and exact boundary", () => {
  const atHead = evaluateGraphRisk(input(response(0)));
  assert.equal(atHead.indexingLag, 0n);
  assert.equal(atHead.evidenceUsable, true);

  const within = evaluateGraphRisk(input(response(0, { indexedBlock: head - 19n })));
  assert.equal(within.indexingLag, 19n);
  assert.equal(within.evidenceUsable, true);

  const boundary = evaluateGraphRisk(input(response(0, { indexedBlock: head - 20n })));
  assert.equal(boundary.indexingLag, 20n);
  assert.equal(boundary.evidenceUsable, true);
});

test("stale or future indexed blocks fail closed", () => {
  const stale = evaluateGraphRisk(input(response(0, { indexedBlock: head - 21n })));
  assert.equal(stale.decision, "BLOCK");
  assert.equal(stale.evidenceUsable, false);
  assert.match(stale.reason, /stale/);

  const future = evaluateGraphRisk(input(response(0, { indexedBlock: head + 1n })));
  assert.equal(future.decision, "BLOCK");
  assert.equal(future.evidenceUsable, false);
  assert.match(future.reason, /ahead/);
});

test("invalid freshness inputs fail closed", () => {
  for (const overrides of [
    { chainHeadBlock: -1 },
    { chainHeadBlock: 1.5 },
    { maxAllowedLag: -1 },
    { maxAllowedLag: "1.5" },
  ]) {
    const result = evaluateGraphRisk(input(response(0), overrides));
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.evidenceUsable, false);
  }
});

test("Graph indexing errors fail closed", () => {
  const result = evaluateGraphRisk(input(response(0, { hasIndexingErrors: true })));
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.evidenceUsable, false);
  assert.match(result.reason, /health/);
});

test("missing or malformed Graph metadata fails closed", () => {
  const cases = [
    {},
    { data: {} },
    { data: { violations: [], _meta: null } },
    { data: { violations: [], _meta: { hasIndexingErrors: false } } },
    { data: { violations: [], _meta: { hasIndexingErrors: false, block: {} } } },
    { data: { violations: [], _meta: { hasIndexingErrors: false, block: { number: "abc" } } } },
  ];
  for (const graphResponse of cases) {
    const result = evaluateGraphRisk(input(graphResponse));
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.evidenceUsable, false);
  }
});

test("top-level GraphQL errors fail closed", () => {
  const result = evaluateGraphRisk(input({ ...response(0) as object, errors: [{ message: "indexer unavailable" }] }));
  assert.equal(result.decision, "BLOCK");
  assert.equal(result.evidenceUsable, false);
  assert.match(result.reason, /contains errors/);

  const malformed = evaluateGraphRisk(input({ ...response(0) as object, errors: {} }));
  assert.equal(malformed.decision, "BLOCK");
  assert.equal(malformed.evidenceUsable, false);
  assert.match(malformed.reason, /malformed Graph errors/);
});

test("missing, non-array, or over-cap violations fail closed", () => {
  const baseMeta = { block: { number: head.toString() }, hasIndexingErrors: false };
  const cases = [
    { data: { _meta: baseMeta } },
    { data: { violations: {}, _meta: baseMeta } },
    response(4),
  ];
  for (const graphResponse of cases) {
    const result = evaluateGraphRisk(input(graphResponse));
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.evidenceUsable, false);
    assert.equal(result.recentViolationCount, null);
  }
});

test("malformed or out-of-window violation timestamps fail closed", () => {
  const meta = { block: { number: head.toString() }, hasIndexingErrors: false };
  const cases = [
    { data: { violations: [{}], _meta: meta } },
    response(1, { timestamp: "not-a-number" }),
    response(1, { timestamp: -1 }),
    response(1, { timestamp: windowStart - 1n }),
    response(1, { timestamp: now + 1n }),
  ];
  for (const graphResponse of cases) {
    const result = evaluateGraphRisk(input(graphResponse));
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.evidenceUsable, false);
  }
});

test("timestamp window boundaries are inclusive", () => {
  assert.equal(evaluateGraphRisk(input(response(1, { timestamp: windowStart }))).evidenceUsable, true);
  assert.equal(evaluateGraphRisk(input(response(1, { timestamp: now }))).evidenceUsable, true);
});

test("the requested lookup window must be exactly 24 hours", () => {
  const shortWindow = evaluateGraphRisk(input(response(0), { windowStartTimestamp: windowStart + 1n }));
  assert.equal(shortWindow.decision, "BLOCK");
  assert.equal(shortWindow.evidenceUsable, false);
  assert.match(shortWindow.reason, /exactly 24 hours/);
});
