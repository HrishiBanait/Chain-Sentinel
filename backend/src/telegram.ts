export class TelegramError extends Error {
  constructor(
    public readonly status: number, // HTTP/API error code, or 0 for network failures
    public readonly description: string,
    public readonly retryAfter?: number
  ) {
    super(`Telegram error ${status}: ${description}`);
    this.name = "TelegramError";
  }
}

export interface SendArgs {
  chatId: string;
  text: string;
  replyToMessageId?: number;
}

export interface TelegramApi {
  sendMessage(a: SendArgs): Promise<{ messageId: number }>;
}

export interface BotInfo {
  id: number;
  username?: string;
  first_name: string;
}
export interface ChatInfo {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}
export interface TelegramClient extends TelegramApi {
  getMe(): Promise<BotInfo>;
  chatsSeenInUpdates(): Promise<ChatInfo[]>;
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export const redact = (text: string, token: string): string => (token ? text.split(token).join("[redacted]") : text);

/** The bot token is part of the request URL, so errors never include the URL or the underlying cause. */
export function createTelegramClient(token: string, opts: { timeoutMs?: number; baseUrl?: string } = {}): TelegramClient {
  const base = (opts.baseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 15_000;

  async function call<T>(method: string, body: unknown = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new TelegramError(0, (e as Error).name === "TimeoutError" ? "request timed out" : "network error");
    }
    let payload: TgResponse<T> | null = null;
    try {
      payload = (await res.json()) as TgResponse<T>;
    } catch {
      payload = null;
    }
    if (res.ok && payload?.ok) return payload.result as T;
    throw new TelegramError(
      payload?.error_code ?? res.status,
      redact(payload?.description ?? `HTTP ${res.status}`, token),
      payload?.parameters?.retry_after
    );
  }

  return {
    async sendMessage(a) {
      const body: Record<string, unknown> = {
        chat_id: a.chatId,
        text: a.text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      };
      if (a.replyToMessageId !== undefined) {
        body.reply_parameters = { message_id: a.replyToMessageId, allow_sending_without_reply: true };
      }
      const m = await call<{ message_id: number }>("sendMessage", body);
      return { messageId: m.message_id };
    },

    getMe: () => call<BotInfo>("getMe"),

    async chatsSeenInUpdates() {
      type Update = { message?: { chat: ChatInfo }; channel_post?: { chat: ChatInfo }; my_chat_member?: { chat: ChatInfo } };
      const updates = await call<Update[]>("getUpdates", {
        allowed_updates: ["message", "channel_post", "my_chat_member"],
        timeout: 0,
        limit: 100,
      });
      const byId = new Map<number, ChatInfo>();
      for (const u of updates) {
        const chat = u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat;
        if (chat) byId.set(chat.id, chat);
      }
      return [...byId.values()];
    },
  };
}
