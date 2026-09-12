import express, { type Express } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC, X402_TEST_FACILITATOR, type DemoConfig } from "./config.js";

export function createDemoApp(config: DemoConfig): Express {
  const facilitator = new HTTPFacilitatorClient({ url: X402_TEST_FACILITATOR });
  const resourceServer = new x402ResourceServer(facilitator).register(BASE_SEPOLIA_NETWORK, new ExactEvmScheme());
  const app = express();
  app.use(paymentMiddleware({
    "GET /protected": {
      accepts: {
        scheme: "exact",
        network: BASE_SEPOLIA_NETWORK,
        payTo: config.recipient,
        // Explicit atomic units prevent accidental decimal conversion.
        price: { asset: BASE_SEPOLIA_USDC, amount: config.amountAtomic },
        extra: { name: "USDC", version: "2" },
        maxTimeoutSeconds: 300,
      },
      resource: config.resourceUrl,
      description: "IntentLock x402 protected demo resource",
      mimeType: "application/json",
      unpaidResponseBody: () => ({ contentType: "application/json", body: { message: "IntentLock x402 protected demo resource", purpose: "ETHOnline 2026" } }),
    },
  }, resourceServer));
  app.get("/protected", (_request, response) => response.json({ message: "IntentLock x402 protected demo resource", purpose: "ETHOnline 2026" }));
  return app;
}
