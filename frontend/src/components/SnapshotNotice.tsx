import { fmtTime } from "@/lib/format";

export default function SnapshotNotice({ at, network }: { at: number | null; network: string }) {
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      <p className="font-semibold">Hosted demo: a snapshot of a real {network} run</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          The alerts, explanations and audit records below are real and were captured {fmtTime(at)}. Each published record can be checked against the chain with the Verify button.
        </li>
        <li>
          Target settings are read live from the chain. Registrations and changes you sign with your wallet are real {network} transactions (testnet tokens: faucet.mstblockchain.com).
        </li>
        <li>
          New alerts need the live monitor, which this hosted demo does not run, so a target you register here will not produce alerts. The full pipeline runs from the repository (see the README).
        </li>
      </ul>
    </div>
  );
}
