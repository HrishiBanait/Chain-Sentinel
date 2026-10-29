import { createServer } from "node:http";
import { createApi } from "../api.js";
import { loadMonitorSettings } from "../config.js";

const s = loadMonitorSettings();
const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? "8787");
const origins = (process.env.API_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const api = createApi({
  dbPath: s.dbPath,
  network: s.network,
  chainId: s.chain.id,
  chainName: s.chain.name,
  registryAddress: s.registryAddress,
  explorerUrl: s.chain.blockExplorers?.default.url ?? "",
  confirmations: Number(s.confirmations),
  monitoredTokens: s.monitoredTokens,
  allowedOrigins: origins,
});

const server = createServer(api.handler);
server.listen(port, host, () => {
  console.log(`ChainSentinel API | http://${host}:${port} | ${s.chain.name} | read-only | db ${s.dbPath}`);
  console.log(`allowed origins: ${origins.join(", ")}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n${sig}: shutting down`);
    server.close(() => {
      api.close();
      process.exit(0);
    });
  });
}
