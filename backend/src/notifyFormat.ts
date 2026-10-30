export interface NotifyAlert {
  alertId: string;
  targetId: number;
  targetAddress: string | null;
  ruleId: string;
  severity: number;
  title: string;
  observed: string;
  assessment: string;
  caveat: string;
  sourceTxHash: string;
  blockNumber: number;
}

export interface NotifyEnv {
  networkLabel: string;
  isTestnet: boolean;
  explorerUrl: string;
  dashboardUrl?: string | null;
}

const SEV = [
  { label: "INFO", icon: "🔵" },
  { label: "LOW", icon: "🟡" },
  { label: "MEDIUM", icon: "🟠" },
  { label: "HIGH", icon: "🔴" },
  { label: "CRITICAL", icon: "🚨" },
];

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string => escapeHtml(s).replace(/"/g, "&quot;");
const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1) + "…");
const shortHex = (h: string): string => (h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);
const trimSlash = (s: string): string => s.replace(/\/+$/, "");

const MAX_LEN = 3900; // Telegram's limit is 4096 characters of parsed text; keep a margin

export function formatAlertMessage(a: NotifyAlert, env: NotifyEnv): string {
  const sev = SEV[a.severity] ?? SEV[0];
  const network = env.isTestnet ? `${env.networkLabel} (testnet)` : `${env.networkLabel} (MAINNET)`;
  const target = a.targetAddress ? ` (<code>${escapeHtml(shortHex(a.targetAddress))}</code>)` : "";
  const txLink = `<a href="${escAttr(`${trimSlash(env.explorerUrl)}/tx/${a.sourceTxHash}`)}">Source transaction</a>`;
  const dash = env.dashboardUrl ? ` · <a href="${escAttr(env.dashboardUrl)}">Dashboard</a>` : "";

  const header = [
    `${sev.icon} <b>${sev.label}: ${escapeHtml(clip(a.title, 120))}</b>`,
    `${escapeHtml(network)} · target #${a.targetId}${target} · block ${a.blockNumber}`,
  ];
  const links = [`${txLink}${dash}`, `Rule ${escapeHtml(a.ruleId)} · alert ${escapeHtml(shortHex(a.alertId))}`];
  const body = [
    "",
    "<b>Observed on-chain</b>",
    escapeHtml(clip(a.observed, 900)),
    "",
    "<b>Why it was flagged</b> (rule-based, not a verdict)",
    escapeHtml(clip(a.assessment, 700)),
    "",
    `<i>Not shown by this alert: ${escapeHtml(clip(a.caveat, 500))}</i>`,
    "",
  ];

  const full = [...header, ...body, ...links].join("\n");
  return full.length <= MAX_LEN ? full : [...header, "", ...links].join("\n");
}

export function formatRetraction(title: string | null, alertId: string): string {
  const name = title ? `“${escapeHtml(clip(title, 120))}” ` : "";
  return `↩️ <b>Alert retracted</b>\n${name}(alert ${escapeHtml(shortHex(alertId))}) was removed after a chain reorganization: its source event is no longer on the canonical chain. Disregard the earlier message.`;
}
