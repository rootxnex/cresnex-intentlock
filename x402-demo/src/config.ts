export const BASE_SEPOLIA_NETWORK = "eip155:84532" as const;
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
export const USDC_DECIMALS = 6;
export const X402_TEST_FACILITATOR = "https://x402.org/facilitator";

export type DemoConfig = {
  recipient: `0x${string}`;
  amountAtomic: string;
  port: number;
  resourceUrl: string;
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function loadConfig(env = process.env): DemoConfig {
  const recipient = required(env, "X402_DEMO_RECIPIENT");
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient) || /^0x0{40}$/i.test(recipient)) throw new Error("X402_DEMO_RECIPIENT must be a nonzero EVM address");
  const amountAtomic = required(env, "X402_DEMO_AMOUNT_ATOMIC");
  if (!/^[1-9][0-9]*$/.test(amountAtomic)) throw new Error("X402_DEMO_AMOUNT_ATOMIC must be a positive atomic-unit integer");
  const port = Number(env.X402_DEMO_PORT ?? "4021");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("X402_DEMO_PORT must be a valid TCP port");
  const resourceUrl = env.X402_DEMO_RESOURCE_URL ?? `http://127.0.0.1:${port}/protected`;
  const url = new URL(resourceUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("X402_DEMO_RESOURCE_URL must be HTTP(S)");
  return { recipient: recipient as `0x${string}`, amountAtomic, port, resourceUrl: url.toString() };
}
