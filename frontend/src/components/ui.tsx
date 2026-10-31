import type { ReactNode } from "react";

export type Tone = "ok" | "wait" | "warn" | "bad" | "muted" | "testnet" | "mainnet" | "mint";

const TONE: Record<Tone, string> = {
  ok: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/25",
  wait: "bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/25",
  warn: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/25",
  bad: "bg-red-400/15 text-red-300 ring-1 ring-red-400/30",
  muted: "bg-white/10 text-slate-400 ring-1 ring-white/10",
  testnet: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/25",
  mainnet: "bg-red-400/15 text-red-200 ring-1 ring-red-400/30",
  mint: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30",
};

export function Pill({ children, tone }: { children: ReactNode; tone: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-700/80 bg-slate-900/70 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-sm ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, className = "mb-4" }: { children: ReactNode; className?: string }) {
  return <h2 className={`${className} text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400`}>{children}</h2>;
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "primary" | "ghost" | "warn";
  type?: "button" | "submit";
}) {
  const cls =
    tone === "primary"
      ? "bg-emerald-400 text-slate-950 hover:bg-emerald-300"
      : tone === "warn"
        ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
        : "bg-white/10 text-slate-100 hover:bg-white/15";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${cls}`}
    >
      {children}
    </button>
  );
}

export function Linkish({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="font-mono text-sky-300 hover:underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
