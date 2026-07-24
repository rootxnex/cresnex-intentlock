# Security policy

Cresnex IntentLock is an unaudited, testnet-only research beta. Do not use it to custody real assets.

## Supported versions

Only the latest commit on `main` and the latest tagged beta release receive security fixes. Earlier commits, forks, and deployments may remain vulnerable.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Latest `v0.x` beta | Yes |
| Older snapshots | No |

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include affected commit/deployment, reproduction steps, impact, and a minimal proof of concept.

If private vulnerability reporting is unavailable, contact a repository maintainer privately and disclose only enough information to establish a secure reporting channel.

Maintainers should acknowledge a complete report within five business days. Triage and remediation timelines depend on severity and maintainer availability. No bug bounty or payment is promised.

## Scope

In scope:

- signature, nonce, domain, and authorization bypasses;
- containment or rollback failures;
- strike, quarantine, or evidence-integrity failures;
- reentrancy and external-self-call isolation failures;
- frontend intent/hash mismatches that could authorize different calls;
- deployment or CI behavior that exposes signing material; and
- dependency vulnerabilities with a demonstrated project impact.

Known research limitations are documented in `docs/threat-model.md`. Reports that merely restate a documented limitation may be closed, but concrete exploit paths that exceed the documented impact are welcome.

## Handling reports

Security fixes should:

- reproduce the issue with a failing test;
- avoid publishing exploit details before a fix is available;
- preserve evidence needed for academic evaluation;
- update the threat model and affected documentation; and
- receive contract-focused review before release.

Testnet deployments may be paused or replaced without notice during remediation.
