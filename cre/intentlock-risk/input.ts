import { getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import type { VerdictBindings } from "./verdict";

const UINT256_MAX = (1n << 256n) - 1n;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("intent request must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new TypeError(`${field} must be a valid address`);
  }
  const normalized = getAddress(value);
  if (normalized === zeroAddress) throw new RangeError(`${field} must be nonzero`);
  return normalized;
}

function uint256(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${field} must be a canonical unsigned decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) throw new RangeError(`${field} exceeds uint256`);
  return parsed;
}

function bytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !BYTES32.test(value)) {
    throw new TypeError(`${field} must be an exact bytes32 hex value`);
  }
  if (value.toLowerCase() === ZERO_BYTES32) throw new RangeError(`${field} must be nonzero`);
  return value as Hex;
}

export function parseIntentBindings(value: unknown): VerdictBindings {
  const input = record(value);
  const allowed = new Set(["account", "agent", "nonce", "callsHash", "policyHash"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`unexpected intent request field: ${key}`);
  }
  return {
    account: address(input.account, "account"),
    agent: address(input.agent, "agent"),
    nonce: uint256(input.nonce, "nonce"),
    callsHash: bytes32(input.callsHash, "callsHash"),
    policyHash: bytes32(input.policyHash, "policyHash"),
  };
}
