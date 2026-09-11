import { encodeAbiParameters, isAddress, keccak256, parseAbiParameters, stringToHex, type Address } from "viem";
import type { IntentLockX402PaymentIntent, X402PaymentRequired, X402PaymentRequirement } from "./types";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}
function amount(value: unknown): string {
  const parsed = text(value, "amount");
  if (!/^(0|[1-9][0-9]*)$/.test(parsed)) throw new Error("amount must be an unsigned atomic-unit integer");
  return parsed;
}
function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} must be an address`);
  return value;
}

export function parsePaymentRequired(value: unknown): X402PaymentRequired {
  const root = record(value, "PaymentRequired");
  if (root.x402Version !== 2) throw new Error("only x402Version 2 is supported");
  const resource = record(root.resource, "resource");
  const resourceUrl = text(resource.url, "resource.url");
  new URL(resourceUrl);
  if (!Array.isArray(root.accepts) || root.accepts.length === 0) throw new Error("accepts must contain a payment requirement");
  const accepts = root.accepts.map((entry, index): X402PaymentRequirement => {
    const requirement = record(entry, `accepts[${index}]`);
    if (requirement.scheme !== "exact") throw new Error("only the exact payment scheme is supported");
    const network = text(requirement.network, "network");
    if (!/^eip155:[1-9][0-9]*$/.test(network)) throw new Error("network must be a CAIP-2 EVM identifier");
    const timeout = requirement.maxTimeoutSeconds;
    if (!Number.isSafeInteger(timeout) || (timeout as number) <= 0) throw new Error("maxTimeoutSeconds must be positive");
    return { scheme: "exact", network: network as `eip155:${string}`, amount: amount(requirement.amount), asset: address(requirement.asset, "asset"), payTo: address(requirement.payTo, "payTo"), maxTimeoutSeconds: timeout as number, extra: typeof requirement.extra === "object" && requirement.extra !== null ? requirement.extra as Record<string, unknown> : undefined };
  });
  return { x402Version: 2, resource: { url: resourceUrl, description: typeof resource.description === "string" ? resource.description : undefined, mimeType: typeof resource.mimeType === "string" ? resource.mimeType : undefined, serviceName: typeof resource.serviceName === "string" ? resource.serviceName : undefined }, accepts, error: typeof root.error === "string" ? root.error : undefined, extensions: typeof root.extensions === "object" && root.extensions !== null ? root.extensions as Record<string, unknown> : undefined };
}

export function buildPaymentIntent(required: X402PaymentRequired, method: "GET" | "POST", selection = 0, now: bigint): IntentLockX402PaymentIntent {
  const accepted = required.accepts[selection];
  if (!accepted) throw new Error("selected payment requirement is unavailable");
  const url = new URL(required.resource.url);
  if (url.username || url.password || url.hash) throw new Error("resource URL must not include credentials or a fragment");
  const chainId = BigInt(accepted.network.slice("eip155:".length));
  const validUntil = now + BigInt(accepted.maxTimeoutSeconds);
  const resourcePath = `${url.pathname}${url.search}`;
  const requestHash = keccak256(encodeAbiParameters(
    parseAbiParameters("uint8,string,string,string,uint256,address,uint256,address,uint256"),
    [2, accepted.scheme, url.hostname.toLowerCase(), `${method}:${resourcePath}`, chainId, accepted.asset, BigInt(accepted.amount), accepted.payTo, validUntil],
  ));
  return { serviceDomain: url.hostname.toLowerCase(), resourcePath, method, chainId, token: accepted.asset, amount: BigInt(accepted.amount), recipient: accepted.payTo, paymentScheme: accepted.scheme, validUntil, sessionBudgetId: keccak256(stringToHex(`x402-session:${url.hostname.toLowerCase()}`)), requestHash };
}
