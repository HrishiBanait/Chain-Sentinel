# Roadmap

Everything under "Proposed" is **not implemented**. Nothing here assumes that any grant is available or has been applied for.

## Implemented

- Registry contract with reporter authorization, duplicate protection and two-step admin transfer (48 Foundry tests including fixtures).
- Monitor with confirmation depth, checkpoints, reorg handling and atomic batches.
- Three deterministic rule families (ownership, pause, large transfer).
- Audit-record publisher with crash recovery and re-verification.
- Dashboard with BridgeKey, target management and in-browser verification.
- Telegram notifications with retractions.
- Scripted scenario runner and metrics report.

## Proposed

### Hardening (before mainnet)

- Per-owner and total target caps and an hourly publication budget.
- A public, hosted demo behind TLS with rate limiting.
- Contract source verification on MSTScan and the mainnet deployment.

### Detection and contracts

- Per-token thresholds with decimals (needs a contract change).
- More patterns: access-control role changes, proxy upgrade events, and others, driven by what MST protocols use.
- Optional AI-generated summaries that restate the stored evidence and never create findings.

### Product

- Team features: shared watchlists, per-target notification routing, Slack and Discord.
- Public status page with coverage and reliability metrics.
- Batched evidence commitments to reduce publication gas.
- Multi-network monitoring where there is demand.

### Ecosystem

- A reusable monitoring package for MST developers.
- Public-good monitoring of MST ecosystem contracts, if teams opt in.

## Metrics collected today

Detection correctness on scripted scenarios, duplicate-alert rate, stage latencies, checkpoint recovery under fault injection, notification delivery and number of monitored targets. See [EVIDENCE.md](EVIDENCE.md). Real-world usage and demand are **not yet measured**.
