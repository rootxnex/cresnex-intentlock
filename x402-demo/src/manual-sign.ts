import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createWalletClient, custom } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC } from "./config.js";

export type Eip1193Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

const PAYER = "0x0C8700bF8864f4B85b05CDF0BefD14f4b00e720B".toLowerCase();
const MERCHANT = "0x80AB2fEd3E5E1076CdEAE06749aAf183E98f0Cd6".toLowerCase();
const TOKEN = BASE_SEPOLIA_USDC.toLowerCase();

export function createMetaMaskSigner(provider: Eip1193Provider, account: `0x${string}`) {
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: custom(provider as any) });
  return { address: account, signTypedData: (message: any) => walletClient.signTypedData({
    account, domain: message.domain, types: message.types, primaryType: message.primaryType, message: message.message,
  }) };
}

export function validatePaymentRequired(required: any): void {
  if (required.x402Version !== 2) throw new Error("x402 version must be 2");
  if (!Array.isArray(required.accepts) || required.accepts.length !== 1) throw new Error("exactly one x402 payment requirement is required");
  const requirement = required.accepts[0];
  const resource = required.resource;
  if (requirement.maxTimeoutSeconds !== 300) throw new Error("x402 timeout must be 300 seconds");
  if (!resource || resource.url !== "http://127.0.0.1:4021/protected" ||
      resource.description !== "IntentLock x402 protected demo resource" || resource.mimeType !== "application/json") {
    throw new Error("x402 resource metadata mismatch; refusing to sign");
  }
  if (!requirement.extra || requirement.extra.name !== "USDC" || requirement.extra.version !== "2") {
    throw new Error("x402 EIP-712 asset metadata mismatch; refusing to sign");
  }
  if (requirement.network !== BASE_SEPOLIA_NETWORK || requirement.asset.toLowerCase() !== TOKEN ||
      requirement.amount !== "1000" || requirement.payTo.toLowerCase() !== MERCHANT ||
      requirement.scheme !== "exact") {
    throw new Error("x402 payment requirement mismatch; refusing to sign");
  }
}

/** Fetches a fresh 402, verifies every public payment field, and asks MetaMask to sign once. */
export async function signFreshPayment(provider: Eip1193Provider): Promise<string> {
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  if (accounts.length !== 1 || accounts[0].toLowerCase() !== PAYER) throw new Error("connected payer does not match approved account");
  const chain = await provider.request({ method: "eth_chainId" }) as string;
  if (BigInt(chain) !== 84532n) throw new Error("wallet must be connected to Base Sepolia (84532)");
  const response = await fetch("http://127.0.0.1:4021/protected", { headers: { accept: "application/json" } });
  if (response.status !== 402) throw new Error(`expected fresh 402, got ${response.status}`);
  const encoded = response.headers.get("payment-required");
  if (!encoded) throw new Error("missing PAYMENT-REQUIRED header");
  const required = decodePaymentRequiredHeader(encoded);
  validatePaymentRequired(required);
  const account = accounts[0] as `0x${string}`;
  const signer = createMetaMaskSigner(provider, account);
  const client = registerExactEvmScheme(new x402Client(), { signer, networks: [BASE_SEPOLIA_NETWORK] });
  const payload = await client.createPaymentPayload(required);
  return encodePaymentSignatureHeader(payload);
}
