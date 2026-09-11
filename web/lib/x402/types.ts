import type { Address, Hex } from "viem";

export type X402PaymentRequirement = {
  scheme: "exact";
  network: `eip155:${string}`;
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

export type X402PaymentRequired = {
  x402Version: 2;
  resource: { url: string; description?: string; mimeType?: string; serviceName?: string };
  accepts: X402PaymentRequirement[];
  error?: string;
  extensions?: Record<string, unknown>;
};

export type IntentLockX402PaymentIntent = {
  serviceDomain: string;
  resourcePath: string;
  method: "GET" | "POST";
  chainId: bigint;
  token: Address;
  amount: bigint;
  recipient: Address;
  paymentScheme: "exact";
  validUntil: bigint;
  sessionBudgetId: Hex;
  requestHash: Hex;
};

export type X402Policy = {
  allowedDomains: readonly string[];
  allowedMethods: readonly ("GET" | "POST")[];
  allowedChainId: bigint;
  allowedToken: Address;
  allowedRecipients: readonly Address[];
  maxAmount: bigint;
  sessionBudgetRemaining: bigint;
  now: bigint;
};

export type X402RiskInput = {
  decision: "ALLOW" | "ESCALATE" | "BLOCK";
  evidenceUsable: boolean;
};

export type X402Decision = "ALLOW" | "ESCALATE" | "BLOCK";

export type X402Evaluation = {
  decision: X402Decision;
  reason: string;
  policyHash: Hex;
  evidenceHash: Hex;
};

export type X402IntentBinding = {
  account: Address;
  agent: Address;
  nonce: bigint;
  callsHash: Hex;
  policyHash: Hex;
};
