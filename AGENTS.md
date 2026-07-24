# Cresnex IntentLock repository guidance

- Treat contracts as security-critical research code.
- Never weaken tests merely to make them pass.
- Never remove access control without explicit justification; never use `tx.origin`.
- Avoid arbitrary `delegatecall`. Do not add upgradeability unless requested.
- Preserve external-self-call isolation and persistent containment.
- Run formatting, compilation, tests, frontend lint, typecheck, and build before completion.
- Explain security-relevant changes and update documentation when public APIs change.
- Never commit secrets. Clearly label mocks, research code, and production code.

