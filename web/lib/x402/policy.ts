import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import type { IntentLockX402PaymentIntent, X402Policy, X402RiskInput } from "./types";

export function hashX402Policy(policy: X402Policy): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("string[],string[],uint256,address,address[],uint256,uint256"), [
    [...policy.allowedDomains].map((domain) => domain.toLowerCase()).sort(), [...policy.allowedMethods].sort(), policy.allowedChainId,
    policy.allowedToken, [...policy.allowedRecipients].map((recipient) => recipient.toLowerCase() as Address).sort(), policy.maxAmount, policy.sessionBudgetRemaining,
  ]));
}

export function evaluateX402Policy(intent: IntentLockX402PaymentIntent, policy: X402Policy, risk: X402RiskInput): { decision: "ALLOW" | "ESCALATE" | "BLOCK"; reason: string; policyHash: Hex } {
  const policyHash = hashX402Policy(policy);
  if (!risk.evidenceUsable) return { decision: "BLOCK", reason: "risk evidence is unavailable or stale", policyHash };
  if (intent.validUntil <= policy.now) return { decision: "BLOCK", reason: "payment requirement has expired", policyHash };
  if (!policy.allowedDomains.map((value) => value.toLowerCase()).includes(intent.serviceDomain)) return { decision: "BLOCK", reason: "service domain is not approved", policyHash };
  if (!policy.allowedMethods.includes(intent.method)) return { decision: "BLOCK", reason: "HTTP method is not approved", policyHash };
  if (intent.chainId !== policy.allowedChainId) return { decision: "BLOCK", reason: "payment chain is not approved", policyHash };
  if (intent.token.toLowerCase() !== policy.allowedToken.toLowerCase()) return { decision: "BLOCK", reason: "payment token is not approved", policyHash };
  if (!policy.allowedRecipients.map((value) => value.toLowerCase()).includes(intent.recipient.toLowerCase())) return { decision: "BLOCK", reason: "payment recipient is not approved", policyHash };
  if (intent.amount > policy.maxAmount) return { decision: "BLOCK", reason: "payment amount exceeds the per-request maximum", policyHash };
  if (intent.amount > policy.sessionBudgetRemaining) return { decision: "BLOCK", reason: "payment amount exceeds the remaining session budget", policyHash };
  if (risk.decision === "BLOCK") return { decision: "BLOCK", reason: "Graph/CRE risk decision blocks autonomous payment", policyHash };
  if (risk.decision === "ESCALATE") return { decision: "ESCALATE", reason: "Graph/CRE risk decision requires human approval", policyHash };
  return { decision: "ALLOW", reason: "approved x402 request and usable Graph/CRE ALLOW evidence", policyHash };
}
