import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import type { IntentLockX402PaymentIntent, X402Decision, X402IntentBinding } from "./types";

const code = (decision: X402Decision) => decision === "ALLOW" ? 0 : decision === "ESCALATE" ? 1 : 2;

export function hashX402Evidence(intent: IntentLockX402PaymentIntent, binding: X402IntentBinding, decision: X402Decision): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("uint8,string,string,uint256,address,uint256,address,address,uint256,bytes32,uint8,bytes32,address,uint256,bytes32"), [
    1, intent.serviceDomain, intent.resourcePath, intent.chainId, intent.token, intent.amount, intent.recipient,
    binding.agent, binding.nonce, intent.requestHash, code(decision), binding.policyHash, binding.account, binding.nonce, binding.callsHash,
  ]));
}
