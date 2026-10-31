const STEPS = [
  { n: "01", title: "Register", text: "Wallet signs a target into the MST registry." },
  { n: "02", title: "Monitor", text: "Confirmed events become alerts with evidence." },
  { n: "03", title: "Publish", text: "The reporter writes an audit-record hash on-chain." },
  { n: "04", title: "Notify", text: "Telegram gets the observed fact, assessment and caveat." },
  { n: "05", title: "Verify", text: "Anyone recomputes the hash and checks MSTScan." },
];

export default function Pipeline() {
  return (
    <section className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">How a detection travels</p>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-xl border border-slate-700/70 bg-slate-800/60 p-3">
            <p className="font-mono text-[11px] text-emerald-300">{s.n}</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{s.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
