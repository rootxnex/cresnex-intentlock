# IntentLock x402 demo resource

Isolated project-controlled Express resource for an unpaid x402 V2 `402` proof. It is not part of the Next.js app and contains no payer, signer, payment retry, `PAYMENT-SIGNATURE`, settlement, or key material.

## Run locally

Copy `.env.example` to a local ignored `.env` equivalent and provide only a public nonzero recipient address and a reviewed atomic USDC amount. For example, `1000` is **0.001 USDC** with six decimals, but it is a test fixture—not a preapproved live amount.

```bash
npm install
X402_DEMO_RECIPIENT=0x... X402_DEMO_AMOUNT_ATOMIC=1000 npm run dev
curl -i http://127.0.0.1:4021/protected
```

The expected unpaid result is `402` with a `PAYMENT-REQUIRED` header. Stop there. Do not attach a `PAYMENT-SIGNATURE` header.
