# ChainSentinelRegistry on MST Testnet (development deployment)

Recorded: 2026-10-28 17:40 UTC
Network: MST Testnet, chain ID 91562037
Compiler: solc 0.8.24, EVM target paris, optimizer 200 runs

| Item | Value |
|---|---|
| Contract | [0xc9f3d85de752a4112c6399c2bb6eb7f06697d945](https://testnet.mstscan.com/address/0xc9f3d85de752a4112c6399c2bb6eb7f06697d945) |
| Deployment tx | [0xce18ba40233a35f802c9e28d70c9e40dcef1c8a453782c5c831eb983fb1c00e5](https://testnet.mstscan.com/tx/0xce18ba40233a35f802c9e28d70c9e40dcef1c8a453782c5c831eb983fb1c00e5) |
| Deployer (no special authority) | 0x6e377DD5C5D55c25094BaeFf4eeE736ee4097d4e |
| Admin | 0x52A1404119C7119986b8149f155B9bC1254F1047 |
| Initial reporter | 0xd42C15c727D8Af7D88524E4164B010d31158D793 |
| registerTarget tx | [0x1e318dc62a80fe69fda3ad7eca094b2e4ca327d6cc4cf853a0c67a04ad09d981](https://testnet.mstscan.com/tx/0x1e318dc62a80fe69fda3ad7eca094b2e4ca327d6cc4cf853a0c67a04ad09d981) |
| publishAlert tx (smoke test) | [0x0e37bee65e921a046a152103a88ec8c403449e2b42629d6106630ed59add90e1](https://testnet.mstscan.com/tx/0x0e37bee65e921a046a152103a88ec8c403449e2b42629d6106630ed59add90e1) |

The registered target is a demo address and the published alert is a smoke test:
its evidence hash is the hash of a text label, not a real detection. A published
record proves only that the reporter submitted it and that it was included on-chain.

Independent checks performed with cast: receipt status, admin and reporter state,
on-chain bytecode equal to the local build, event topic equal to the expected
signature hash, and duplicate and unauthorized publishes rejected.
