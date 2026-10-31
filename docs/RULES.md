# Detection rules

All rules are deterministic. An alert is an observation plus a rule-based assessment. None of these events is automatically malicious.

| Rule ID | Trigger | Severity | What it does not show |
|---|---|---|---|
| `ownership.changed` | `OwnershipTransferred(previousOwner, newOwner)` emitted by a registered address, where the previous owner is not the zero address, the owner actually changed, and the new owner is not the zero address | High | Often routine (key rotation, handover to a multisig or timelock). Not evidence of an unauthorized change. |
| `ownership.renounced` | The same event with the new owner equal to the zero address | Medium | Often intentional. It means owner-only functions may become permanently unavailable. |
| `pause.paused` | `Paused(account)` emitted by a registered address | Medium | Pausing is a normal safety control and is often a protective response. |
| `pause.unpaused` | `Unpaused(account)` emitted by a registered address | Low | Normal after maintenance or an incident response. Does not show that the cause was fixed. |
| `transfer.large` | ERC-20 `Transfer` of a monitored token where the value is at least the target's threshold and the registered address is the sender or the recipient | Medium, High from 10 times the threshold | Can be routine treasury activity. Not evidence of theft. |

No alert is raised for the initial ownership assignment at deployment, or for a transfer of ownership to the current owner (which changes nothing).

## Rule versions

| Version | Change |
|---|---|
| 1 | Initial rules |
| 2 | A transfer of ownership to the current owner no longer raises an alert. Found while writing the ground truth for the scenario tests. Alerts created before the change keep version 1 in their evidence. |

## Coverage limits

- Only standard OpenZeppelin-style event signatures are decoded. Contracts with custom ownership or pause events are not covered.
- ERC-721 `Transfer` logs (four topics) are ignored.
- Thresholds are in raw token units. Decimals and prices are not applied, so one number can mean very different amounts for different tokens. The token list (`MONITOR_TOKENS`) is global, not per target. A threshold of 0 turns the transfer rule off for a target.
- There is no behavioural or anomaly detection, no transaction simulation and no detection of attacks that emit none of these events.
- Monitoring starts when an address is registered. Earlier events are not fetched.
- Alerts depend on the confirmation depth and RPC availability. A long outage delays alerts and is not currently reported to users beyond the dashboard's monitor status.
