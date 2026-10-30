import type { ApiAlert, ApiAlertDetail, ApiConfig, ApiHealth, ApiTarget } from "./types";

// Override with NEXT_PUBLIC_API_URL in frontend/.env.local (that file is git-ignored).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, { cache: "no-store" });
  } catch {
    throw new Error(`Cannot reach the ChainSentinel API at ${API_URL}. Is "npm run api" running in backend/?`);
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `API error ${res.status}`);
  return body as T;
}

export const api = {
  config: () => getJson<ApiConfig>("/api/config"),
  health: () => getJson<ApiHealth>("/api/health"),
  targets: async () => (await getJson<{ targets: ApiTarget[] }>("/api/targets")).targets,
  alerts: (q: { minSeverity?: number; targetId?: number; limit?: number; includeOrphaned?: boolean }) => {
    const p = new URLSearchParams();
    if (q.minSeverity !== undefined) p.set("minSeverity", String(q.minSeverity));
    if (q.targetId !== undefined) p.set("targetId", String(q.targetId));
    if (q.includeOrphaned) p.set("includeOrphaned", "1");
    p.set("limit", String(q.limit ?? 50));
    return getJson<{ alerts: ApiAlert[]; total: number }>("/api/alerts?" + p.toString());
  },
  alert: async (id: string) => (await getJson<{ alert: ApiAlertDetail }>(`/api/alerts/${id}`)).alert,
};
