import { short, txUrl } from "@/lib/format";

export interface TxRecord {
  hash: string;
  label: string;
  status: "pending" | "success" | "failed" | "unknown";
}

const CHIP: Record<TxRecord["status"], string> = {
  pending: "cs-chip-warn",
  success: "cs-chip-ok",
  failed: "cs-chip-bad",
  unknown: "cs-chip-muted",
};
const LABEL: Record<TxRecord["status"], string> = { pending: "Pending", success: "Confirmed", failed: "Failed", unknown: "Unknown" };

export default function TxList({ txs, explorerUrl, confirmations }: { txs: TxRecord[]; explorerUrl: string; confirmations: number | null }) {
  if (txs.length === 0) return null;
  return (
    <section className="cs-txs" aria-labelledby="tx-heading">
      <h2 id="tx-heading" className="cs-h3">
        Your transactions this session
      </h2>
      <ul>
        {txs.map((t) => (
          <li key={t.hash} className="cs-tx">
            <span className={`cs-chip ${CHIP[t.status]}`}>{LABEL[t.status]}</span>
            <span>{t.label}</span>
            <a className="cs-mono" href={txUrl(explorerUrl, t.hash)} target="_blank" rel="noreferrer">
              {short(t.hash, 10, 8)}
            </a>
          </li>
        ))}
      </ul>
      <p className="cs-help">
        {confirmations !== null
          ? `Changes show up in the lists once the monitor has seen ${confirmations} confirmations of the transaction.`
          : "Changes to watched addresses show up in the list within a few seconds."}
      </p>
    </section>
  );
}
