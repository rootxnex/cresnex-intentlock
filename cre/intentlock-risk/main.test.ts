import { describe, expect, test } from "bun:test";
import { parseGraphEvidence } from "./graph";
import { decisionForCount, evaluateGraphRisk } from "./risk";
import { buildRiskVerdict, encodeRiskVerdict, VERDICT_FIELD_ORDER } from "./verdict";

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

const ACCOUNT = "0x4423D32fE243D06D7F025Ef4855BC24185704168" as const;
const AGENT = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const HASH_A = `0x${"11".repeat(32)}` as const;
const HASH_B = `0x${"22".repeat(32)}` as const;

function verdict(count: number, changes: Record<string, unknown> = {}) {
  const evaluation = evaluate(response(count));
  return buildRiskVerdict({
    evaluation,
    bindings: {
      account: (changes.account ?? ACCOUNT) as typeof ACCOUNT,
      agent: (changes.agent ?? AGENT) as typeof AGENT,
      nonce: (changes.nonce ?? 7n) as bigint,
      callsHash: (changes.callsHash ?? HASH_A) as typeof HASH_A,
      policyHash: (changes.policyHash ?? HASH_B) as typeof HASH_B,
    },
    windowStart: START,
    issuedAt: NOW,
    validitySeconds: (changes.validitySeconds ?? 300n) as bigint,
    chainId: (changes.chainId ?? 84_532n) as bigint,
  });
}

describe("versioned RiskVerdict", () => {
  for (const [count, decision] of [[0, "ALLOW"], [1, "ESCALATE"], [2, "ESCALATE"], [3, "BLOCK"]] as const) {
    test(`${decision} verdict from ${count} usable violations`, () => {
      const result = verdict(count);
      expect(result.decision).toBe(decision);
      expect(result.evidenceUsable).toBe(true);
      expect(result.thresholdReached).toBe(count === 3);
    });
  }

  test("operational failure remains distinguishable from genuine BLOCK", () => {
    const failed = buildRiskVerdict({
      evaluation: evaluate("malformed"),
      bindings: { account: ACCOUNT, agent: AGENT, nonce: 7n, callsHash: HASH_A, policyHash: HASH_B },
      windowStart: START, issuedAt: NOW, validitySeconds: 300n,
    });
    expect(failed.decision).toBe("BLOCK");
    expect(failed.evidenceUsable).toBe(false);
    expect(failed.thresholdReached).toBe(false);
  });

  test("unusable evidence cannot produce a positive verdict", () => {
    const inconsistent = { ...evaluate(response(0)), evidenceUsable: false };
    expect(() => buildRiskVerdict({
      evaluation: inconsistent,
      bindings: { account: ACCOUNT, agent: AGENT, nonce: 7n, callsHash: HASH_A, policyHash: HASH_B },
      windowStart: START, issuedAt: NOW, validitySeconds: 300n,
    })).toThrow();
  });

  test("evidence hash and payload are deterministic", () => {
    expect(verdict(1).evidenceHash).toBe(verdict(1).evidenceHash);
    expect(encodeRiskVerdict(verdict(1))).toBe(encodeRiskVerdict(verdict(1)));
  });

  for (const [field, value] of [
    ["agent", "0x1111111111111111111111111111111111111111"],
    ["account", "0x2222222222222222222222222222222222222222"],
    ["nonce", 8n], ["callsHash", HASH_B], ["policyHash", HASH_A], ["chainId", 1n],
  ] as const) {
    test(`changing ${field} changes evidence and payload`, () => {
      const base = verdict(1);
      const changed = verdict(1, { [field]: value });
      expect(changed.evidenceHash).not.toBe(base.evidenceHash);
      expect(encodeRiskVerdict(changed)).not.toBe(encodeRiskVerdict(base));
    });
  }

  test("non-positive validity is rejected", () => {
    expect(() => verdict(0, { validitySeconds: 0n })).toThrow();
    expect(() => verdict(0, { validitySeconds: -1n })).toThrow();
  });

  test("verdict field order is fixed", () => {
    expect(VERDICT_FIELD_ORDER).toEqual([
      "version", "decision", "ruleId", "account", "chainId", "agent", "nonce", "callsHash",
      "policyHash", "recentViolationCount", "graphIndexedBlock", "windowStart", "issuedAt",
      "validUntil", "evidenceUsable", "thresholdReached", "evidenceHash",
    ]);
  });
});
