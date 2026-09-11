import { isAddress, type Address, type Hex } from "viem";
import { buildPaymentIntent, parsePaymentRequired } from "../adapter.ts";
import type { IntentLockX402PaymentIntent, X402PaymentRequired } from "../types.ts";

export const BASE_SEPOLIA_NETWORK = "eip155:84532" as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532n;
// Circle's documented Base Sepolia USDC. This is deliberately distinct from the
// IntentLock deployment's mock USDC and is only used to validate a future real 402.
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

export type LiveX402Requirement = {
  required: X402PaymentRequired;
  intent: IntentLockX402PaymentIntent;
  requirementHash: Hex;
};

function decodeBase64(value: string): unknown {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("PAYMENT-REQUIRED must be canonical base64");
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0))));
  } catch {
    throw new Error("PAYMENT-REQUIRED must contain base64-encoded JSON");
  }
}

export function parsePaymentRequiredHeader(value: string, method: "GET" | "POST", now: bigint): LiveX402Requirement {
  const required = parsePaymentRequired(decodeBase64(value));
  const intent = buildPaymentIntent(required, method, 0, now);
  if (required.accepts.length !== 1) throw new Error("live x402 preparation requires exactly one selected payment requirement");
  if (intent.chainId !== BASE_SEPOLIA_CHAIN_ID || required.accepts[0].network !== BASE_SEPOLIA_NETWORK) throw new Error("only Base Sepolia exact payments are permitted");
  if (intent.paymentScheme !== "exact") throw new Error("only the exact payment scheme is permitted");
  if (intent.token.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) throw new Error("only documented Base Sepolia USDC is permitted for the first live test");
  if (!isAddress(intent.recipient)) throw new Error("payment recipient must be an address");
  return { required, intent, requirementHash: intent.requestHash };
}

export function displayAtomicUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fraction || "0"} USDC`;
}

export function isBaseSepoliaUsdc(address: Address): boolean {
  return address.toLowerCase() === BASE_SEPOLIA_USDC.toLowerCase();
}
