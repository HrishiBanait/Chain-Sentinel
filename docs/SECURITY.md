# Security model

## Status

The contract has **not been independently audited**. Assurance comes from Foundry unit and fuzz tests and from scripted scenario runs on testnet. ChainSentinel observes and records. It does not block transactions, prevent attacks or guarantee detection.

## What the system proves

A published audit record proves that the authorized reporter submitted an alert ID and evidence hash and that the transaction was included on-chain. It does not prove that the alert is correct, that the evidence is complete, or that an attack occurred.

## Roles and trust

| Role | Can | Cannot |
|---|---|---|
| Admin (single account, two-step transfer) | Authorize or revoke reporters, transfer the admin role | Publish alerts, change targets owned by others |
| Reporter | Publish alert records for enabled targets | Publish a duplicate alert ID, change targets, change roles |
| Target owner | Enable or disable their target, change its threshold | Publish alerts, affect other owners' targets |
| Anyone | Register targets (permissionless), read everything | |

The contract holds no funds and has no payable functions. It is not upgradeable. Inputs are validated (zero addresses, zero alert ID, zero evidence hash, unknown or disabled target), and severity is a bounded enum.

A compromised **reporter key** could publish fabricated records for enabled targets until the admin revokes it. Published records cannot be deleted. A compromised **admin key** can authorize a malicious reporter. Both are single externally owned accounts today.

## Secrets

- The reporter key is stored only in an encrypted keystore. The password is entered at a hidden prompt, or read from a file that the program warns about if it is group- or world-readable. The decrypted key stays in process memory, and the program refuses to start if the keystore's address differs from the configured reporter.
- The Telegram bot token is read from `.env` (git-ignored) or a token file. It is part of Telegram's request URL, so error messages never include the URL or the underlying cause, and error descriptions are redacted.
- No secret is ever sent to the frontend. The only frontend setting is the public API URL.
- CI fails if a `.env` file, keystore directory, database, deployment broadcast file, Telegram-token-like string or private-key-like assignment is tracked.

## Network surface

- The read API accepts only GET, opens SQLite read-only, binds to `127.0.0.1` by default and echoes CORS headers only to allowed origins. It has no authentication and no rate limiting, so a public deployment must sit behind a reverse proxy with TLS and rate limits.
- The dashboard sends transactions only to the registry address configured by the API, only after checking that the wallet is on the right network, and never sets fees.
- Telegram messages pass through Telegram's servers. They contain only public on-chain data, but a user should know that alert content leaves their infrastructure.
- Alert text is HTML-escaped and length-limited before it is sent.

## Known gaps (not implemented)

1. **No caps on monitored targets or publication spend.** Registration is permissionless, so an attacker could register many addresses (adding noise and RPC load) or register a busy address and cause the reporter to spend gas publishing alerts. Planned: per-owner and total target caps and an hourly publication budget.
2. **No API authentication or rate limiting** (see above).
3. **Single instance and single database.** The publisher and notifier must each run once. There is no high availability.
4. **Raw-unit transfer thresholds** with a global token list (see [RULES.md](RULES.md)). The contract stores one threshold per target.
5. **Admin and reporter are single accounts,** not multisigs or hardware-backed keys.
6. **Orphaned alerts that were already published** keep their on-chain record. The dashboard marks the alert orphaned, but the record cannot be removed.
7. **Unaudited dependencies.** Lockfiles are committed, Dependabot proposes updates, and CI runs an informational `npm audit`, but there is no formal supply-chain review.

## Reporting a vulnerability

Please report it privately through the repository's GitHub security advisories rather than a public issue. Include steps to reproduce and the affected component.
