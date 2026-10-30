import { readFileSync, statSync } from "node:fs";
import "./chains.js"; // side effect: loads the repo-root .env

export interface NotifySettings {
  token: string;
  chatId: string;
  minSeverity: number;
  maxAgeSecs: number;
  pollIntervalMs: number;
  maxAttempts: number;
  backoffBaseSecs: number;
  maxPerRun: number;
  minIntervalMs: number;
  dashboardUrl: string | null;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

export function loadTelegramToken(): string {
  let token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const file = process.env.TELEGRAM_BOT_TOKEN_FILE;
  if (!token && file) {
    if (statSync(file).mode & 0o077) console.warn(`warning: ${file} is readable by other users; run chmod 600 on it`);
    token = readFileSync(file, "utf8").trim();
  }
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN (or TELEGRAM_BOT_TOKEN_FILE) is not set. Create a bot with @BotFather and put the token in .env.");
  }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new Error("TELEGRAM_BOT_TOKEN does not look like a Telegram bot token (expected something like 123456789:AA...).");
  }
  return token;
}

/** Telegram cannot link to localhost, so such URLs are dropped with a warning. */
function publicUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname) || u.hostname.endsWith(".local");
    if ((u.protocol !== "https:" && u.protocol !== "http:") || local) {
      console.warn("NOTIFY_DASHBOARD_URL is not a public http(s) URL; the dashboard link will be omitted from messages");
      return null;
    }
    return u.toString();
  } catch {
    console.warn("NOTIFY_DASHBOARD_URL is not a valid URL; the dashboard link will be omitted");
    return null;
  }
}

export function loadNotifySettings(): NotifySettings {
  const token = loadTelegramToken();
  const chatId = (process.env.TELEGRAM_CHAT_ID ?? "").trim();
  if (!/^(-?\d+|@[A-Za-z0-9_]{5,})$/.test(chatId)) {
    throw new Error("TELEGRAM_CHAT_ID is missing or invalid. Run `npm run telegram:setup` to find it, then set it in .env.");
  }
  return {
    token,
    chatId,
    minSeverity: num("NOTIFY_MIN_SEVERITY", 0),
    maxAgeSecs: num("NOTIFY_MAX_AGE_SECS", 21_600),
    pollIntervalMs: num("NOTIFY_POLL_INTERVAL_MS", 10_000),
    maxAttempts: num("NOTIFY_MAX_ATTEMPTS", 5),
    backoffBaseSecs: 10,
    maxPerRun: 20,
    minIntervalMs: 1_100,
    dashboardUrl: publicUrl(process.env.NOTIFY_DASHBOARD_URL),
  };
}
