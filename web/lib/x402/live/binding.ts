import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import type { IntentLockX402PaymentIntent, X402IntentBinding } from "../types.ts";

export type LiveX402IntentBinding = X402IntentBinding & { authorizationNonce: Hex };

/** Binds the HTTP authorization to the same execution coordinates IntentLock checks. */
export function hashLiveX402Binding(intent: IntentLockX402PaymentIntent, binding: LiveX402IntentBinding): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("uint8,address,address,uint256,uint256,bytes32,bytes32,bytes32,bytes32,string,string,string,address,uint256,address,uint256"), [1, binding.account, binding.agent, intent.chainId, binding.nonce, binding.callsHash, binding.policyHash, binding.authorizationNonce, intent.requestHash, intent.serviceDomain, intent.resourcePath, intent.method, intent.token, intent.amount, intent.recipient, intent.validUntil]));
}
