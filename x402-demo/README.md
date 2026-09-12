# IntentLock x402 demo resource

Isolated project-controlled Express resource for an x402 V2 exact-EVM testnet proof. It is not part of the Next.js app. The browser signer uses MetaMask/viem; payment settlement is a separately controlled manual step and no key material is stored here.

## Run locally

Copy `.env.example` to a local ignored `.env` equivalent and provide only a public nonzero recipient address and a reviewed atomic USDC amount. For example, `1000` is **0.001 USDC** with six decimals, but it is a test fixture—not a preapproved live amount.

```bash
npm install
X402_DEMO_RECIPIENT=0x... X402_DEMO_AMOUNT_ATOMIC=1000 npm run dev
curl -i http://127.0.0.1:4021/protected
```

The unpaid result is `402` with a `PAYMENT-REQUIRED` header. The verified live proof used one manually reviewed `PAYMENT-SIGNATURE` and one facilitator settlement on Base Sepolia.

## Verified live proof

- Official Circle Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Payer: `0x0C8700bF8864f4B85b05CDF0BefD14f4b00e720B`
- Merchant: `0x80AB2fEd3E5E1076CdEAE06749aAf183E98f0Cd6`
- Amount: `1000` atomic units (`0.001 USDC`)
- Transaction: `0x27aa742192f21bdebd4f60cbbbb05672504141d3de4e6a367ef23d192669c7b0`
- Block: `46724208`; receipt successful; payer decreased by 1000 and merchant increased by 1000.
- Flow: HTTP `402` → MetaMask/viem EIP-712 authorization → facilitator settlement → HTTP `200`.

This proves the x402 payment flow only; it does not claim that IntentLock enforces HTTP domains or paths.
