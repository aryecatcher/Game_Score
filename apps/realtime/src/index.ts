import { loadEnvironment } from "@gamechanger/config";
import { RedisScoreSubscriber } from "@gamechanger/infrastructure";
import { createRealtimeGateway } from "./server.js";

const env = loadEnvironment();
const redisSubscriber = env.REDIS_URL ? new RedisScoreSubscriber(env.REDIS_URL) : undefined;
const gateway = createRealtimeGateway({
  host: env.REALTIME_HOST,
  port: env.REALTIME_PORT,
  apiInternalUrl: env.API_INTERNAL_URL,
  internalServiceToken: env.INTERNAL_SERVICE_TOKEN,
  ...(redisSubscriber ? { redisSubscriber } : {})
});

await gateway.ready;
console.log(JSON.stringify({ service: "realtime", listening: gateway.url() }));

const shutdown = async (): Promise<void> => {
  await gateway.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
