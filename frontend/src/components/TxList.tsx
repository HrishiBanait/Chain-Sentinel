import { short, txUrl } from "@/lib/format";

export interface TxRecord {
  hash: string;
  label: string;
  status: "pending" | "success" | "failed" | "unknown";
}

const STYLE: Record<TxRecord["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  success: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  unknown: "bg-slate-200 text-slate-700",
};

export default function TxList({ txs, explorerUrl, confirmations }: { txs: TxRecord[]; explorerUrl: string; confirmations: number | null }) {
  if (txs.length === 0) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Your transactions this session</h2>
      <ul className="space-y-1 text-sm">
        {txs.map((t) => (
          <li key={t.hash} className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[t.status]}`}>{t.status}</span>
            <span>{t.label}</span>
            <a className="font-mono text-xs text-blue-700 underline" href={txUrl(explorerUrl, t.hash)} target="_blank" rel="noreferrer">
              {short(t.hash, 10, 8)}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        Changes appear in the tables below once the monitor has seen {confirmations ?? "N"} confirmations of the transaction.
      </p>
    </section>
  );
}
