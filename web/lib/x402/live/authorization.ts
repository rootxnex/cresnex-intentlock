import { isHex, type Address, type Hex } from "viem";
import type { IntentLockX402PaymentIntent } from "../types.ts";

export type UnsignedExactAuthorization = { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
export type UnsignedX402PaymentPayload = {
  x402Version: 2;
  accepted: { scheme: "exact"; network: `eip155:${string}`; amount: string; asset: Address; payTo: Address; maxTimeoutSeconds: number };
  payload: { signature: null; authorization: UnsignedExactAuthorization };
};

/** Reviewable data only: `signature` remains null and nothing sends a request. */
export function buildUnsignedExactAuthorization(intent: IntentLockX402PaymentIntent, from: Address, validAfter: bigint, authorizationNonce: Hex): UnsignedX402PaymentPayload {
  if (!isHex(authorizationNonce, { strict: true }) || authorizationNonce.length !== 66) throw new Error("x402 authorization nonce must be bytes32");
  if (validAfter >= intent.validUntil) throw new Error("authorization validity window is empty");
  return { x402Version: 2, accepted: { scheme: "exact", network: `eip155:${intent.chainId}`, amount: intent.amount.toString(), asset: intent.token, payTo: intent.recipient, maxTimeoutSeconds: Number(intent.validUntil - validAfter) }, payload: { signature: null, authorization: { from, to: intent.recipient, value: intent.amount.toString(), validAfter: validAfter.toString(), validBefore: intent.validUntil.toString(), nonce: authorizationNonce } } };
}
