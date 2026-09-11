# x402 live testnet preparation

Status: **PREP ONLY — no payment authorization, request retry, facilitator settlement, or chain transaction has occurred.**

## Official V2 flow

1. A client makes an unpaid HTTP request.
2. A resource server returns `402` and base64 JSON in `PAYMENT-REQUIRED`.
3. The client chooses an `accepts` entry and creates a `PaymentPayload` for its `(scheme, network)` pair.
4. The client retries with a base64 `PAYMENT-SIGNATURE` header.
5. The resource server calls a facilitator's read-only `/verify` when its flow requires verification.
6. On a valid authorization it fulfils the resource, settles via the facilitator, and returns `PAYMENT-RESPONSE` with settlement data.

The current official TypeScript packages are `@x402/core`, `@x402/fetch` or `@x402/axios`, and `@x402/evm`; the buyer pattern is `x402Client`, `ExactEvmScheme`, then `wrapFetchWithPayment` or `wrapAxiosWithPayment`. IntentLock intentionally does **not** instantiate that signer in this phase because it would make authorization possible.

## Base Sepolia constraints

- Network: `eip155:84532` / chain ID `84532`.
- Testing facilitator: `https://x402.org/facilitator`, the official no-setup test/development facilitator.
- First-token allowlist: Circle Base Sepolia USDC, `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, six decimals. IntentLock's deployed mock USDC is not a live x402 settlement asset.
- Exact EVM settlement is onchain. The reference payload uses a signed authorization (`from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`) and the facilitator verifies then settles it.

No public third-party Base Sepolia paid resource is adopted for the first test: an arbitrary service would add trust, availability, recipient, and commercial coupling. The first real test should instead use a minimal project-controlled x402 resource in a separate later phase, served with the official middleware and test facilitator. It must expose a deterministic response and a displayed, reviewed recipient before any signing approval.

## IntentLock binding before authorization

Before a signer is ever invoked, the adapter must deterministically bind:

`account, agent, chainId, IntentLock manifest nonce, callsHash, policyHash, x402 authorization nonce, requestHash, serviceDomain, resourcePath, HTTP method, token, amount, recipient, payment scheme, validUntil`.

`requestHash` derives from the selected V2 requirement and request coordinates. The prep implementation separately hashes all the values above. A future exact settlement call must be modeled first so IntentLock's existing `callsHash` and `policyHash` bind the actual call rather than a synthetic approximation.

## First-payment safety gate

The first real payment is blocked unless all of these are shown and manually approved: Base Sepolia, Circle test USDC, exact recipient, atomic and display amount, service domain/path/method, `exact` scheme, requirement/request hash, active expiry, fresh IntentLock manifest nonce, fresh x402 authorization nonce, matching calls/policy hashes, risk decision `ALLOW`, and usable Graph/CRE evidence. Any absent, stale, malformed, or mismatched value is `BLOCK`.

The amount must be taken from the controlled resource's actual 402 requirement; no numeric maximum is hard-coded here. Before signing, configure the single-payment maximum and session maximum to that exact lowest supported atomic price, use the resource's short timeout, and consume both nonces after a successful authorized attempt.

## Replay and idempotency

x402 exact EVM uses a one-time authorization nonce and the authorization validity window; facilitator/server behavior must still be checked from the returned `PAYMENT-RESPONSE`. IntentLock adds a distinct manifest nonce and commits `requestHash`. A retry may only reuse the exact original request and authorization under an explicit idempotency policy; it must never be silently regenerated or rebound to another domain, path, amount, recipient, or nonce.

## Scope and next phase

`web/lib/x402/live/` only decodes a `PAYMENT-REQUIRED` header, validates the constrained first-test requirement, builds an unsigned payload with `signature: null`, and produces a deterministic binding. It emits no `PAYMENT-SIGNATURE` header and performs no fetch, signing, retry, `/verify`, `/settle`, or broadcast.

Nansen remains a possible phase-two paid API only after this controlled protocol proof. Reown is not required: the existing wagmi/viem/MetaMask stack is compatible with a later explicit user-signing UI, provided the official x402 signer interface can be adapted without exposing keys.
