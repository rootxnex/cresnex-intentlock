# Project-controlled x402 Express demo

This isolated `x402-demo/` service exists because the current official `@x402/next` package requires Next 16 while IntentLock's production frontend remains on Next 15.5.21. It uses the official V2 server components `@x402/express`, `@x402/core`, and `@x402/evm`: `paymentMiddleware`, `x402ResourceServer`, `HTTPFacilitatorClient`, and `ExactEvmScheme`.

`GET /protected` is a project-controlled deterministic resource. With no payment header, the official middleware emits a V2 `402 Payment Required` response and `PAYMENT-REQUIRED`; it is configured for `exact`, `eip155:84532`, Circle Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimals), and the x402.org test facilitator.

The merchant recipient is never committed: `X402_DEMO_RECIPIENT` must be a public, valid, nonzero EVM address. `X402_DEMO_AMOUNT_ATOMIC` is also required; the test fixture uses `1000` atomic units (= `0.001` USDC) only to prove requirement generation. It is not a production or preapproved payment amount.

## Captured unpaid proof

The isolated test starts the official middleware locally and makes exactly one unpaid `GET /protected`. It received `HTTP 402`, a base64 `PAYMENT-REQUIRED` header, and no `PAYMENT-SIGNATURE` header. The test-only, non-merchant fixture decoded to `exact`, `eip155:84532`, Circle Base Sepolia USDC, amount `1000`, recipient `0x1111111111111111111111111111111111111111`, and `maxTimeoutSeconds: 60`. With fixed test time `1789000000`, the resulting request hash is `0xca625887bb7f325caa2910df5bb2820a0d6fff312601c13e9c9f1a3b67121497`.

The captured unpaid requirement is passed through IntentLock's Base-Sepolia-only parser, produces a deterministic request hash and unsigned authorization (`signature: null`), then derives the existing IntentLock binding. The controlled test fixture passes the existing preflight with a test-only `ALLOW` risk input and reaches **PREPARE PAYMENT ELIGIBLE**; it is not payment authorization. A runtime request remains **PAYMENT BLOCKED** until a reviewed recipient allowlist, amount, domain/path/method, fresh nonces, matching hashes, usable evidence, and a live `ALLOW` risk verdict are supplied. The Simulator can display a manually pasted unpaid header but never sends it or creates a payment payload.

**NO PAYMENT WAS SIGNED OR SETTLED.** No `PAYMENT-SIGNATURE` is created, no paid request is retried, no facilitator `verify` or `settle` method is invoked with a payload, and no Base Sepolia transaction is sent. The next phase requires separate approval for one displayed, manually approved Base Sepolia payment.
