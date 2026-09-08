import { describe, expect, test } from "bun:test";
import { parseGraphEvidence } from "./graph";
import { decisionForCount, evaluateGraphRisk } from "./risk";

const NOW = 2_000_000n;
const START = NOW - 86_400n;
function response(count: number, overrides: Record<string, unknown> = {}) {
  return { data: {
    violations: Array.from({ length: count }, (_, index) => ({
      timestamp: (NOW - BigInt(index)).toString(), transactionHash: `0x${index}`,
    })),
    _meta: { block: { number: "1000" }, hasIndexingErrors: false }, ...overrides,
  } };
}
function evaluate(graphResponse: unknown) {
  return evaluateGraphRisk({ response: graphResponse, chainHeadBlock: 1_005n, maxAllowedLag: 10n,
    windowStart: START, evaluationTimestamp: NOW });
}

describe("deterministic risk boundaries", () => {
  for (const [count, decision] of [[0, "ALLOW"], [1, "ESCALATE"], [2, "ESCALATE"], [3, "BLOCK"]] as const) {
    test(`${count} violations => ${decision}`, () => {
      const result = evaluate(response(count));
      expect(decisionForCount(count)).toBe(decision);
      expect(result.decision).toBe(decision);
      expect(result.evidenceUsable).toBe(true);
      expect(result.thresholdReached).toBe(count === 3);
    });
  }
});

describe("fail-closed evidence validation", () => {
  test("malformed JSON is rejected", () => expect(() => parseGraphEvidence("{")).toThrow());
  test("malformed Graph response blocks", () => expect(evaluate("bad").evidenceUsable).toBe(false));
  test("GraphQL errors block", () => expect(evaluate({ ...response(0), errors: [{ message: "failed" }] }).decision).toBe("BLOCK"));
  test("indexing errors block", () => expect(evaluate(response(0, {
    _meta: { block: { number: "1000" }, hasIndexingErrors: true },
  })).evidenceUsable).toBe(false));
  test("stale indexed block blocks", () => {
    const result = evaluateGraphRisk({ response: response(0), chainHeadBlock: 1_011n, maxAllowedLag: 10n,
      windowStart: START, evaluationTimestamp: NOW });
    expect(result.reason).toContain("stale");
  });
  test("indexed block ahead of chain blocks", () => {
    const result = evaluateGraphRisk({ response: response(0), chainHeadBlock: 999n, maxAllowedLag: 10n,
      windowStart: START, evaluationTimestamp: NOW });
    expect(result.reason).toContain("ahead");
  });
  test("malformed timestamp blocks", () => expect(evaluate(response(0, {
    violations: [{ timestamp: "1.5" }],
  })).evidenceUsable).toBe(false));
  test("out-of-window timestamp blocks", () => expect(evaluate(response(0, {
    violations: [{ timestamp: (START - 1n).toString() }],
  })).evidenceUsable).toBe(false));
  test("more than three records blocks", () => expect(evaluate(response(4)).evidenceUsable).toBe(false));
  test("missing metadata blocks", () => expect(evaluate(response(0, { _meta: undefined })).evidenceUsable).toBe(false));
  test("window must be exactly 24 hours", () => expect(evaluateGraphRisk({
    response: response(0), chainHeadBlock: 1_005n, maxAllowedLag: 10n,
    windowStart: START + 1n, evaluationTimestamp: NOW,
  }).evidenceUsable).toBe(false));
});
