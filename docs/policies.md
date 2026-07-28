# Implemented v2 policy modules

> Research beta, testnet only, unaudited, and unsuitable for real assets.

`CresnexIntentLockAccountV2` implements the core, controlled DeFi, bounded payment, NFT-purchase, and administration research modules described below.

## Common outcome constraints

Each ERC-20 constraint measures:

- maximum decrease of the account balance;
- minimum increase at an exact recipient; and
- optional minimum final account balance.

Allowance constraints bind an exact token and spender to a maximum final allowance. Native constraints bind maximum account ETH spend and an optional minimum final balance.

Arrays are bounded to eight asset constraints and eight allowance constraints. Calls are bounded to sixteen.

## Transfer

The module binds ERC-20 versus native transfer mode, exact token, exact recipient, maximum amount, exact target, and transfer selector. ERC-20 calldata is decoded and checked before execution. Native transfers require empty calldata and the recipient as the target.

## Swap

The module binds the approved router, input token, output token, and exact output recipient. The policy must contain constraints for both named assets. Enforcement uses observed balance deltas and final allowances rather than router return values.

Because calls are also signed exactly, Phase 1 intentionally does not attempt to support arbitrary production router formats.

## Approval

The module binds the exact token, spender, requested approval ceiling, final allowance ceiling, and optional zero-only workflow. The call must be a single standard `approve(address,uint256)` call.

## Ordered batch

Every target, native value, calldata byte, operation, array length, and position is signed. Aggregate asset and allowance constraints apply across the complete batch. Added, removed, reordered, or modified calls fail authentication.

## DeFi deposit

The initial adapter accepts the ERC-4626-shaped `deposit(uint256,address)` interface used by `MockERC4626Vault`. It binds:

- exact vault and underlying asset;
- maximum assets deposited;
- minimum shares received;
- exact share beneficiary; and
- maximum final asset allowance to the vault.

Assets and shares are verified using observed balance deltas. Return values from the vault are not trusted.

The call set may contain one deposit and a standard asset approval for that exact vault. Other calls to the asset or vault are rejected even when their spending would fit the aggregate limit.

## DeFi withdrawal

The initial adapter accepts `withdraw(uint256,address,address)`. It binds:

- exact vault and underlying asset;
- maximum shares burned;
- minimum assets received;
- exact asset recipient; and
- the IntentLock account as the share owner.

Unexpected share loss, insufficient assets, and wrong-recipient delivery revert inside the isolated frame.

## Controlled yield rebalance

This is not a yield optimizer. It allows exact ordered calls among:

- one signed underlying asset;
- at least two vaults committed by an ordered approved-vault hash; and
- one signed deterministic research price source.

The policy limits aggregate measured movement and requires a minimum final portfolio value. Portfolio value is the account's underlying balance plus each approved vault-share balance multiplied by its deterministic mock price.

Approved vaults must be unique. Vault calls are restricted to the mock deposit/withdraw interfaces, must keep the IntentLock account as receiver/share owner, and asset calls are restricted to zero-residual approvals for an approved destination vault.

Real oracle security, price freshness, slippage across production protocols, liquidation risk, MEV, and market risk remain outside this beta.

## DAO treasury payment

This is a bounded payment policy, not a DAO governance integration. It binds the exact token, recipient, maximum payment, unique purpose/reference hash, and exact signed call. An optional signed budget ID, epoch length, and epoch budget track cumulative successful payments. Reused references and exceeded budgets are authenticated policy violations.

## Payroll

Payroll binds the exact employee, token, maximum amount, unique payment ID, period, and earliest/latest execution timestamps. Both the payment ID and the token/employee/period tuple are single-use. Successful state is recorded only after the isolated transfer and outcome checks commit.

## Subscription

Subscriptions bind an exact merchant, token, per-period maximum, billing interval, start/end timestamps, payment-count maximum, and unique subscription ID. Only one successful payment is allowed per derived billing period. The owner can permanently cancel an ID with `cancelSubscription`.

Time checks use `block.timestamp` and therefore inherit normal validator timestamp tolerance. Subscription packages and signatures are public authorization data, not secrets.

## NFT purchase

The initial NFT adapter supports only the repository's mock marketplace entry points for ERC-721 and ERC-1155 purchases. It binds the exact marketplace, collection, payment token, maximum price, NFT recipient, token ID commitment, token standard, and minimum ERC-1155 quantity.

Payment approval is limited to the signed marketplace and price, and the final allowance is measured after execution. The isolated frame also verifies final ERC-721 ownership or ERC-1155 balance; payment without delivery, wrong-recipient delivery, and excessive spend are rolled back. The account accepts single ERC-721 and ERC-1155 safe transfers through a selector-restricted receiver fallback.

This is not a universal marketplace adapter. Production order formats, royalties, collection impersonation, off-chain order validity, criteria bids, and marketplace-specific callbacks are outside this research slice.

## Administration

Administration policies permit exactly one zero-value call to one signed target and one allowlisted selector. Supported mock operations are:

- bounded numeric parameter or treasury-limit updates;
- an exact approved-address update;
- pause/unpause; and
- granting one exact role to one exact address.

An optional `validAfter` timestamp delays execution. Ownership transfer, proxy upgrades, arbitrary calldata, extra calls, and `delegatecall` are not permitted. Multi-owner approval and production governance integration remain out of scope.

## Failure classes

- Authentication or structural failures revert the outer transaction, do not consume the nonce, and do not strike.
- Authenticated policy violations consume the nonce, revert inner effects, persist compact evidence, and add exactly one strike.
- Ordinary target failures consume the authenticated nonce, roll back inner effects, emit `ExecutionFailed`, and do not strike.

Consuming a nonce on ordinary failure prevents a signed package from being retried under unexpectedly changed external state. A new owner signature is required for a retry.
