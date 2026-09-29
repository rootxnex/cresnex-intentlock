# Trust boundaries and exclusions

The owner authorizes packages and controls agent registration, containment
recovery and threshold configuration. Owner compromise is outside the
authorization guarantee. Agent identity is the caller; relayer support must
not be inferred. Token balance/allowance reads are external observations, so
truthful standard-token behavior is a measurement assumption. Account-local
EVM rollback does not establish cross-chain or asynchronous rollback.

Only supplied constraints are measured. Calls to arbitrary targets do not
establish safety of the target, or universal protection from malicious tokens,
oracle manipulation, gas griefing or MEV. ERC-4337/6900/7579 integration is not
established by this collection. V3, x402, CRE and subgraph functionality are
outside this V2 source review. No production-security claim is made.
