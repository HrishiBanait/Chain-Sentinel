"use client";

import { useEffect, useState } from "react";
import { addressUrl, short, txUrl } from "@/lib/format";

interface Deployment {
  network: string;
  chainId: number;
  registry: string;
  deployTx: string;
  explorer: string;
  deployedAt: string;
}

/** Shows the mainnet deployment if /deployments.json exists (written by scripts/record-mainnet.py). */
export default function DeploymentsNote() {
  const [d, setD] = useState<Deployment | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/deployments.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j.registry === "string") setD(j as Deployment);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!d) return null;
  return (
    <div className="cs-notice cs-notice-plain">
      <strong>{d.network} deployment.</strong> Registry{" "}
      <a className="cs-mono" href={addressUrl(d.explorer, d.registry)} target="_blank" rel="noreferrer">
        {short(d.registry, 8, 6)}
      </a>
      , deployed in{" "}
      <a className="cs-mono" href={txUrl(d.explorer, d.deployTx)} target="_blank" rel="noreferrer">
        {short(d.deployTx, 8, 6)}
      </a>{" "}
      on {d.deployedAt}. This page shows testnet data; the mainnet registry holds only labelled smoke-test records so far.
    </div>
  );
}
