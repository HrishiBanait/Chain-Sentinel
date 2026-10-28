# ChainSentinel

Explainable, verifiable on-chain risk monitoring, built on MST Blockchain.

## Status

| Component | State |
|---|---|
| `ChainSentinelRegistry.sol` | Implemented. 36 Foundry tests pass locally. Exercised on a local Anvil node. |
| MST Testnet deployment | Not yet done |
| MST Mainnet deployment | Not yet done |
| Backend monitor and rules engine | Not yet done (connectivity check only) |
| Frontend and BridgeKey | Not yet done (scaffold only) |

No contract addresses or transaction hashes are published yet. They will be added only after they exist on-chain.

## Layout

- `contracts/` Foundry project (Solidity 0.8.24, EVM target `paris`)
- `backend/` Node.js + TypeScript (Viem)
- `frontend/` Next.js + TypeScript + Tailwind
- `docs/` architecture, security model and metrics (to come)

## Quick start

    git clone --recurse-submodules https://github.com/HrishiBanait/Chain-Sentinel.git
    cd Chain-Sentinel/contracts && forge test
