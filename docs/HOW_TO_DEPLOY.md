# How to deploy and run ChainSentinel (local video walkthrough)

This is the recording guide: how to host the **full live pipeline on your machine**, pointed at **MST Testnet**, and what to say while each piece comes up.

The hosted Vercel page cannot run the monitor, publisher or notifier. For a video of **publish** and **notify**, you run those processes locally. The dashboard is `http://localhost:3000`.

A shorter pitch script lives in [DEMO.md](DEMO.md). Architecture detail is in [ARCHITECTURE.md](ARCHITECTURE.md).

**Do not film:** `.env`, Telegram bot tokens, keystore passwords, private keys, or any terminal that echoed a secret.

---

## What you are deploying

Five processes, plus the MST registry contract.

| Process | Where | What it does | What to say on camera |
|---|---|---|---|
| Registry | MST Testnet | Source of truth for targets and append-only audit records | "The contract stores who is monitored and a hash of each alert. It does not decide if something is an attack." |
| Monitor | `backend/` `npm run monitor` | Reads confirmed logs, applies rules, writes SQLite | "After about 12 confirmations it turns supported events into alerts with evidence." |
| Publisher | `backend/` `npm run publish` | Sends `publishAlert` from the reporter key | "It writes `(alertId, targetId, evidenceHash, severity)` on-chain. A record proves inclusion, not correctness." |
| Notifier | `backend/` `npm run notify` | Sends one Telegram message per alert | "Observed, assessment and caveat are three separate fields, plus the source transaction." |
| API | `backend/` `npm run api` | Read-only HTTP on `127.0.0.1:8787` | "The dashboard never sees keys. It only reads this API and the chain." |
| Dashboard | `frontend/` `npm run dev` | UI, BridgeKey, Verify on MST | "Connect wallet, register a target, open an alert, verify the hash." |

Data flows: **chain → monitor → SQLite → publisher → chain**, and **SQLite → notifier → Telegram**, and **SQLite → API → dashboard**.

---

## Prerequisites

- Node.js 24 (see `.nvmrc`) and [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`).
- Clone with submodules:

      git clone --recurse-submodules https://github.com/HrishiBanait/Chain-Sentinel.git
      cd Chain-Sentinel
      (cd backend && npm ci)
      (cd frontend && npm ci)

- MST Testnet RPC: `https://testnetrpc.mstblockchain.com` (chain ID `91562037`). Explorer: `https://testnet.mstscan.com`. Faucet: `https://faucet.mstblockchain.com`.
- [BridgeKey](https://bridgekey.io) for dashboard transactions (recommended).
- Optional for notify: a Telegram bot from [@BotFather](https://t.me/BotFather).

---

## Path A (recommended for the video): reuse the public testnet deployment

Skip contract deployment. Point `.env` at the addresses already on MST Testnet (also listed in the README):

| Item | Value |
|---|---|
| Registry | `0xC9f3D85De752a4112c6399c2bB6eb7f06697d945` |
| Deploy tx | `0xce18ba40233a35f802c9e28d70c9e40dcef1c8a453782c5c831eb983fb1c00e5` |
| Admin | `0x52A1404119C7119986b8149f155B9bC1254F1047` |
| Reporter | `0xd42C15c727D8Af7D88524E4164B010d31158D793` |
| Demo token (fixture only) | `0x58e42c5f3472f10d350aba6d5bff1b82bc50a28c` |
| Deployer (token owner) | `0x6e377DD5C5D55c25094BaeFf4eeE736ee4097d4e` |

**Publish only works if you hold the authorized reporter keystore** for `0xd42C15c727D8Af7D88524E4164B010d31158D793` (or you deploy your own registry in Path B and authorize your own reporter).

**Triggering pause/transfer on the demo token** needs the deployer/owner keystore for `0x6e377DD5C5D55c25094BaeFf4eeE736ee4097d4e`.

If you do not have those keys, still start monitor + API + dashboard to show existing alerts, or use Path B.

---

## Path B: deploy your own registry (and optional demo token)

You need three funded testnet accounts (or two if admin = reporter, which is weaker):

1. **Deployer** — pays gas, has no special role after deploy.
2. **Admin** — authorizes reporters.
3. **Reporter** — the only address that can call `publishAlert`.

Create encrypted Foundry keystores (never commit them; never paste keys into `.env`):

    cast wallet import cs-testnet-deployer --interactive
    cast wallet import cs-testnet-admin --interactive
    cast wallet import cs-testnet-reporter --interactive

    cast wallet address --keystore ~/.foundry/keystores/cs-testnet-deployer
    cast wallet address --keystore ~/.foundry/keystores/cs-testnet-admin
    cast wallet address --keystore ~/.foundry/keystores/cs-testnet-reporter

Fund them from the faucet.

### Deploy the registry

From `contracts/`, with `ADMIN_ADDRESS` and `REPORTER_ADDRESS` set to the admin and reporter **addresses** (not keys). MST Testnet accepted the deploy as a legacy transaction with an explicit 2 gwei gas price; the node also requires a priority fee of at least 1 gwei.

    cd contracts
    ADMIN_ADDRESS=0xYourAdmin REPORTER_ADDRESS=0xYourReporter \
      forge script script/DeployChainSentinelRegistry.s.sol:DeployChainSentinelRegistry \
      --rpc-url https://testnetrpc.mstblockchain.com \
      --keystore ~/.foundry/keystores/cs-testnet-deployer \
      --broadcast --legacy --with-gas-price 2000000000 -vvvv

Note the printed `ChainSentinelRegistry` address and the broadcast transaction hash. Then:

    cast receipt <deployTx> blockNumber --rpc-url https://testnetrpc.mstblockchain.com
    cast call <registry> "admin()(address)" --rpc-url https://testnetrpc.mstblockchain.com
    cast call <registry> "isReporter(address)(bool)" <reporter> --rpc-url https://testnetrpc.mstblockchain.com

### Optional: demo token (for pause / transfer / ownership in the video)

    forge script script/DeployDemoGuardedToken.s.sol:DeployDemoGuardedToken \
      --rpc-url https://testnetrpc.mstblockchain.com \
      --keystore ~/.foundry/keystores/cs-testnet-deployer \
      --broadcast --legacy --with-gas-price 2000000000 -vvvv

The deployer becomes the token owner. Register **that token address** as a target (dashboard or `cast`) so the monitor watches it. Put the token in `MONITOR_TOKENS` if you want the large-transfer rule.

---

## Configure `.env`

    cp .env.example .env

Fill at least:

    MST_TESTNET_REGISTRY_ADDRESS=0x…
    MST_TESTNET_DEPLOY_BLOCK=<block number of the registry deploy tx>
    MST_TESTNET_ADMIN_ADDRESS=0x…
    MST_TESTNET_REPORTER_ADDRESS=0x…
    MST_TESTNET_DEPLOYER_ADDRESS=0x…          # token owner, for the scenario runner
    MST_TESTNET_DEMO_TOKEN_ADDRESS=0x…        # optional fixture
    MONITOR_NETWORK=testnet
    MONITOR_TOKENS=0x…                        # comma-separated; empty = large-transfer rule off
    API_HOST=127.0.0.1
    API_PORT=8787
    API_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
    REPORTER_KEYSTORE_PATH=~/.foundry/keystores/cs-testnet-reporter
    PUBLISH_MIN_SEVERITY=0
    TELEGRAM_BOT_TOKEN=                       # .env only, never the example file
    TELEGRAM_CHAT_ID=
    NOTIFY_MIN_SEVERITY=0
    NOTIFY_DASHBOARD_URL=                     # public URL only; localhost is ignored

Frontend (optional; defaults already point at the local API):

    echo 'NEXT_PUBLIC_API_URL=http://127.0.0.1:8787' > frontend/.env.local

`frontend/.env.local` is git-ignored.

---

## Telegram (notify)

1. Create a bot with BotFather, copy the token into `TELEGRAM_BOT_TOKEN` in `.env` only.
2. Open the bot in Telegram and press Start.
3. From `backend/`:

       npm run telegram:setup

   Put the printed chat id in `TELEGRAM_CHAT_ID`.
4. Smoke test (sends one message, then exits):

       npm run notify -- --test

Narration: "Notify is optional. If it is not running, alerts still appear on the dashboard and can still be published on-chain."

---

## Start the local stack (five terminals)

Install once. Then, from `backend/` unless noted.

**Terminal 1 — monitor**

    npm run monitor

Wait until it prints `head … | checkpoint …`. Narrate: it will sit a few blocks behind the head because of `MONITOR_CONFIRMATIONS` (default 12, about 36 seconds on testnet).

**Terminal 2 — publisher (needs the reporter keystore password once)**

    npm run publish

You should see `authorized reporter` in the banner. Optional check first:

    npm run reporter:check

Narrate: "One publisher instance per registry. It polls, simulates `publishAlert`, sends the transaction, then re-reads the record after confirmations."

**Terminal 3 — notifier**

    npm run notify

Narrate: "At-least-once delivery. A reorg of an announced alert gets a retraction message."

**Terminal 4 — API**

    npm run api

Leave this on `127.0.0.1`. Do not expose it to the internet for the video.

**Terminal 5 — dashboard**

    cd frontend
    npm run dev

Open [http://localhost:3000](http://localhost:3000). Status pills should read **TESTNET**, **Monitor running**, **Publisher running**, **Notifier running**.

If a pill is "not seen", that process is not writing heartbeats to the same SQLite file (wrong `MONITOR_DB_PATH` or it has not completed a run). If it is "stale", the process stopped.

---

## On-camera walkthrough (about 4–5 minutes)

1. **Problem (20 s).** Teams need to notice ownership changes, pauses and large transfers, with an explanation they can show a reviewer, without building their own indexer.
2. **Dashboard (30 s).** Testnet badge, three live pills, the five-step strip (Register → Monitor → Publish → Notify → Verify), registered targets.
3. **Register (45 s).** Connect BridgeKey, switch to MST Testnet if asked, register the demo token (or a throwaway address) with a threshold, approve in the wallet. Say that the row appears after the confirmation depth.
4. **Trigger (20 s).** Pause the fixture (see below). Start this **before** you need the alert: confirmations take about a minute.
5. **Alert (45 s).** Point at the three blocks: observed (fact), why flagged (rule), what it does not show. Open Telegram and show the same three fields.
6. **Publish (45 s).** The audit-record banner turns green and shows a transaction. Open it on MSTScan. Say: "This is `publishAlert`. Duplicate alert ids are rejected by the contract."
7. **Verify (45 s).** Expand evidence, click **Verify on MST**, walk the checks, copy the `cast` commands if you want a CLI shot.
8. **Close (20 s).** Limits: supported events only, not an audit, not mainnet yet. Point at this repo and [EVIDENCE.md](EVIDENCE.md).

### Triggering a pause without the full scenario runner

If you own the demo token:

    cast send $MST_TESTNET_DEMO_TOKEN_ADDRESS "pause()" \
      --rpc-url https://testnetrpc.mstblockchain.com \
      --keystore ~/.foundry/keystores/cs-testnet-deployer \
      --legacy --with-gas-price 2000000000

Then unpause after the alert lands so the fixture is clean:

    cast send $MST_TESTNET_DEMO_TOKEN_ADDRESS "unpause()" \
      --rpc-url https://testnetrpc.mstblockchain.com \
      --keystore ~/.foundry/keystores/cs-testnet-deployer \
      --legacy --with-gas-price 2000000000

### Full scripted scenario (optional, longer)

From `backend/`, with monitor/publisher/notifier already running:

    npm run scenario -- --dry-run          # check fixture is unpaused / owned by deployer
    npm run scenario -- --external-monitor

`--external-monitor` uses the monitor you already started (the one the dashboard is reading). Hide the password prompt.

---

## What each feature is doing while you wait

**Publish**

- Eligible alerts: status `new`, severity ≥ `PUBLISH_MIN_SEVERITY`.
- If `getAlert` already has the id, it records the existing tx (crash recovery) instead of sending again.
- `TargetDisabled` → skipped. `NotReporter` → process stops. After inclusion it compares the on-chain evidence hash with SQLite. After confirmations it re-checks in case of a reorg.

**Notify**

- One HTML message per alert; text is escaped.
- Skips events older than `NOTIFY_MAX_AGE_SECS` unless you pass `--backfill`.
- `NOTIFY_DASHBOARD_URL` is omitted unless it is a public URL.

**Dashboard Verify**

- Recomputes keccak256 of the exact evidence JSON in the browser.
- Reads `getAlert` and the publish receipt (public RPC, `/api/rpc` proxy, or the wallet).
- A match means the reporter submitted that hash and the tx was included. It does **not** mean the alert is correct.

---

## Hosted demo (not the live pipeline)

Vercel serves a **snapshot** plus live chain reads. New alerts do not appear there. See [HOSTED_DEMO.md](HOSTED_DEMO.md). For the video of publish/notify, stay on localhost.

---

## Claims to avoid on camera

Complete protection, comprehensive exploit detection, that an alert means an attack, that a published record proves the alert is correct, any mainnet deployment (there is none), any grant that has not been awarded.
