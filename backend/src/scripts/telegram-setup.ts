import { loadTelegramToken } from "../notifyConfig.js";
import { createTelegramClient, TelegramError } from "../telegram.js";

const client = createTelegramClient(loadTelegramToken());
try {
  const me = await client.getMe();
  console.log(`bot: @${me.username ?? "(no username)"} (id ${me.id})`);
  const chats = await client.chatsSeenInUpdates();
  if (chats.length === 0) {
    console.log("No chats found yet. Open your bot in Telegram, press Start (or send it any message), then run this again.");
  } else {
    for (const c of chats) console.log(`chat id ${c.id} | ${c.type} | ${c.title ?? c.username ?? c.first_name ?? ""}`);
    console.log("Put the id of the chat you want in .env as TELEGRAM_CHAT_ID.");
  }
} catch (e) {
  console.error(e instanceof TelegramError ? `Telegram error: ${e.description} (${e.status})` : "unexpected error while contacting Telegram");
  process.exit(1);
}
