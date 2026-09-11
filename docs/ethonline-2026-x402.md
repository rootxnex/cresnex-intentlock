# x402 payment-security spike

## Scope

This ETHOnline research spike models how IntentLock can gate an autonomous agent's x402 payment authorization. It is a mock-only TypeScript adapter: it does not sign an x402 payload, contact a paid resource, invoke a facilitator, settle a payment, or change an IntentLock contract.

## Why x402 fits IntentLock

x402 turns an HTTP `402 Payment Required` response into a structured payment requirement. IntentLock already binds an owner-authorized execution to an account, agent, chain, nonce, exact calls hash, policy hash, expiry, measured ERC-20 spend, recipient, and allowance outcomes. The adapter adds the missing HTTP-resource context before a payment authorization is considered.

The protocol's v2 PaymentRequired object carries `resource` and one or more `accepts` requirements. This spike accepts only the `exact` scheme and an EVM CAIP-2 network such as `eip155:84532`. The canonical source is the [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

## Minimal payment intent

The adapter creates an `IntentLockX402PaymentIntent`:

| Field | Source / purpose |
| --- | --- |
| `serviceDomain`, `resourcePath`, `method` | normalized HTTP resource context |
| `chainId`, `token`, `amount`, `recipient`, `paymentScheme` | selected x402 `accepts` requirement |
| `validUntil` | requirement timeout anchored at evaluation time |
| `sessionBudgetId` | deterministic domain-scoped session identifier |
| `requestHash` | deterministic hash of x402 version, scheme, domain, method/path, chain, asset, amount, recipient, and expiry |

For a real execution, the adapter must create the exact payment authorization call/payload first, then derive the existing IntentLock `callsHash` and `policyHash` from it. This spike deliberately does not invent an onchain x402 settlement call.

## Binding and evidence

The x402 evidence hash commits to service domain, resource path, chain, token, amount, recipient, agent, nonce, request hash, risk decision, existing policy hash, account, and calls hash. The same values produce the same hash; changing amount, recipient, or resource changes it. This is a local evidence binding, not a replacement for IntentLock's onchain nonce/replay protection.

## Policy coverage

| Requirement | Current status |
| --- | --- |
| Maximum payment, allowed token, recipient, chain, expiry, nonce | A — existing IntentLock transfer/manifest constraints can enforce these once settlement is represented as an exact call |
| Per-session amount | B — enforced by this mock adapter; persistent enforcement needs an account module or trusted service-side state |
| Per-day budget | A for the existing Treasury Payment epoch budget when its payment shape fits; otherwise B |
| Service domain and endpoint path | B — HTTP context is offchain and must be committed into the signed policy/call adapter; no V2 module currently parses URLs |
| x402 authorization replay | B — x402 authorization nonce is scheme-specific; IntentLock's manifest nonce protects the IntentLock package, but both need binding in a real adapter |
| Generic x402 scheme / arbitrary service | D — intentionally out of scope |

## Graph and CRE reuse

No new risk score is introduced. The adapter consumes the existing narrow signal, “recent indexed IntentLock policy violations,” through the existing decision semantics:

- `ALLOW`: policy may mark the mock payment authorization eligible.
- `ESCALATE`: no autonomous authorization.
- `BLOCK`, unavailable, stale, or malformed risk evidence: no autonomous authorization.

The live Graph subgraph and CRE workflow remain separate verified components. This mock panel uses explicit test inputs to demonstrate the decision boundary; it does not claim a live x402 payment or live CRE delivery.

## Mock demo

The Simulator contains **x402 Payment**, visibly labelled **MOCK / NO SETTLEMENT**. It parses a mock `402` requirement for `https://api.example.com/wallet-analysis`, Base Sepolia mock USDC, and `0.05` USDC. It demonstrates approved, excessive-amount, wrong-recipient, `ESCALATE`, and unusable-risk cases. No signature, network request, payment, or settlement occurs.

## Security assumptions and limits

- A server-controlled 402 requirement is untrusted input and is parsed/allowlisted before use.
- The resource server, facilitator, x402 scheme support, token semantics, and paid-resource delivery are not validated by this spike.
- HTTP domain/path cannot be enforced by current V2 contracts without a separate committed adapter/policy extension.
- The mock session budget is not persistent or onchain.
- Do not treat x402 as reputation or as a substitute for Graph/CRE risk evidence.

## Future work

Nansen is a suitable phase-two paid-resource candidate only after a real x402 service contract is verified. Reown is not needed for this path: the existing wagmi/viem wallet stack is sufficient. A real settlement phase requires scheme-specific authorization support, a reviewed exact-call adapter, an explicit replay model, end-to-end facilitator testing, and a separate security review.
