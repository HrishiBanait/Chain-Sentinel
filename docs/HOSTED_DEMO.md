# Hosted demo

The hosted dashboard is a **demo mode** of the same frontend. Vercel cannot run the long-running monitor, publisher and notifier, so the demo combines a snapshot with live chain access.

| Part | In the hosted demo |
|---|---|
| Alerts, explanations, evidence, audit-record links | Real data from testnet runs, captured in `frontend/public/snapshot.json` (the capture time is shown on the page) |
| Audit-record verification | Live against the chain, through `/api/rpc`, a read-only proxy that allows four methods and `eth_call` only to the registry |
| Target list and settings | Read live from the registry |
| Register, enable/disable, change threshold | Real wallet-signed testnet transactions |
| New alerts | Not available: the monitor does not run in the hosted demo |

## Refresh the snapshot

    cd backend
    npm run monitor -- --once
    npm run publish -- --once
    npm run snapshot
    git add ../frontend/public/snapshot.json && git commit -m "refresh demo snapshot" && git push

## Settings (Vercel project variables)

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_DATA_SOURCE` | `snapshot` (hosted demo) or `api` (live backend) |
| `NEXT_PUBLIC_RPC_PROXY` | `1` to read through `/api/rpc` |
| `MST_RPC_URL`, `MST_CHAIN_ID`, `MST_REGISTRY_ADDRESS` | Upstream node, chain and the only contract the proxy will call |
| `NEXT_PUBLIC_API_URL` | Live API URL when `NEXT_PUBLIC_DATA_SOURCE=api` |

## Limits

The proxy has no rate limiting of its own beyond the platform's. A live deployment needs the backend on an always-on host with a persistent disk, TLS and rate limits (see SECURITY.md).
