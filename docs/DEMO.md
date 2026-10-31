# Demo script (about 4 minutes)

## Before recording

- Run the monitor, publisher, notifier, API and dashboard. The dashboard should show the testnet badge and green status pills.
- Unpause the token and check the fixture is in its starting state (`npm run scenario -- --dry-run`).
- Hide secrets: keystore password prompts are hidden, but do not show `.env`, your Telegram token or any terminal that echoes keys. Show the bot chat only if it contains nothing private.
- Have the trigger command ready in a terminal.
- A fresh alert takes one to two minutes to appear because of the confirmation delay. Start the trigger early and narrate other parts while it arrives, or cut the wait in editing and say so.

## Script

1. **The problem (30 s).** Small DeFi teams and DAO treasuries need to know when ownership changes, contracts pause or large transfers happen, and to explain why it matters, without building monitoring infrastructure.
2. **Dashboard tour (30 s).** Testnet badge, monitor and publisher status, registered targets.
3. **Register a target with BridgeKey (45 s).** Connect, register an address with a threshold, approve in the wallet, show the transaction link. Explain that it appears after the confirmation depth.
4. **Trigger an event (20 s).** Run `pause()` on the fixture token.
5. **Alert arrives (45 s).** Show the three separate blocks: observed, why flagged, what it does not show. Point out the Telegram message arriving.
6. **Audit record and verification (60 s).** Open the audit-record transaction on MSTScan, press "Verify on MST", walk through the checks, then show the same check with `cast`. Say plainly what a record proves and what it does not.
7. **Evidence and close (30 s).** Show `docs/EVIDENCE.md`, the tests and CI, and the roadmap. State what is not done (mainnet deployment status, hosted demo, audit).

## Pitch outline

1. Problem and who has it.
2. Solution in one sentence: explainable alerts with evidence anyone can verify on MST.
3. Why MST: the registry is the source of truth, records are public, BridgeKey authorizes actions.
4. Architecture in one diagram.
5. Evidence: numbers taken from `docs/EVIDENCE.md`, with their limits.
6. Honest limits and roadmap.
7. What help would move it forward.

## Claims to avoid

Complete protection, comprehensive exploit detection, guaranteed security, that an alert means an attack, that a published record proves an alert is correct, anything about mainnet before it exists, and any grant that has not been awarded.
