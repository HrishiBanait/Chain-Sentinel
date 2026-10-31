import { fmtTime } from "@/lib/format";

export default function SnapshotNotice({ at, network, isTestnet = true }: { at: number | null; network: string; isTestnet?: boolean }) {
  return (
    <aside className="cs-notice cs-notice-note" aria-label="About this demo">
      <p>
        <strong>Hosted demo: a snapshot of a real {network} run.</strong>
      </p>
      <ul>
        <li>
          The alerts, explanations and audit records below are real and were captured {fmtTime(at)}. Check any published record against the chain with Verify on MST.
        </li>
        <li>
          Watched addresses and their settings are read live from the chain. Registrations and changes you sign in your wallet are real {network} trsactions
          {isTestnet && (
            <>
              {" "}
              (get test tokens at{" "}
              <a href="https://faucet.mstblockchain.com" target="_blank" rel="noreferrer">
                faucet.mstblockchain.com
              </a>
              )
            </>
          )}
          .
        </li>
        <li>
          New alerts need the live monitor, which this hosted demo does not run, so an address you register here will not produce alerts. The full pipeline runs from the repository (see the README).
        </li>
      </ul>
    </aside>
  );
}
