import { z } from "zod";
import { loadEnvironment } from "@gamechanger/config";
import { ScoreEventSchema } from "@gamechanger/contracts";
import { PostgresOutboxWorkerStore, RedisScorePublisher } from "@gamechanger/infrastructure";

const env = loadEnvironment();
const outboxEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  aggregateId: z.string().uuid(),
  payload: z.record(z.unknown())
});
const listSchema = z.object({ events: z.array(outboxEventSchema) });
let shuttingDown = false;
const postgresQueue = env.APP_MODE === "postgres" ? new PostgresOutboxWorkerStore(env.DATABASE_URL!) : undefined;
const redisPublisher = env.APP_MODE === "postgres" ? new RedisScorePublisher(env.REDIS_URL!) : undefined;

async function internalRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${env.API_INTERNAL_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-service-token": env.INTERNAL_SERVICE_TOKEN,
      ...(init?.headers ?? {})
    }
  });
}

async function processOutbox(): Promise<void> {
  if (postgresQueue && redisPublisher) {
    const events = await postgresQueue.claim(25);
    for (const event of events) {
      try {
        if (event.eventType === "score.event.recorded") {
          const scoreEvent = ScoreEventSchema.parse(event.payload.event);
          await postgresQueue.rebuildGameProjection(scoreEvent.gameId);
          await redisPublisher.publish(scoreEvent);
        }
        console.log(JSON.stringify({ service: "worker", handled: event.eventType, aggregateId: event.aggregateId }));
        await postgresQueue.acknowledge(event.id);
      } catch (error) {
        await postgresQueue.fail(event.id, error instanceof Error ? error.message : "unknown");
      }
    }
    return;
  }
  const response = await internalRequest("/internal/outbox?limit=25");
  if (!response.ok) throw new Error(`Outbox fetch failed with ${response.status}`);
  const { events } = listSchema.parse(await response.json());
  for (const event of events) {
    // P0 worker boundary: notification, analytics and video webhook projections plug in here.
    console.log(JSON.stringify({ service: "worker", handled: event.eventType, aggregateId: event.aggregateId }));
    const ack = await internalRequest(`/internal/outbox/${event.id}/ack`, { method: "POST", body: "{}" });
    if (!ack.ok) throw new Error(`Outbox acknowledge failed with ${ack.status}`);
  }
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    try {
      await processOutbox();
    } catch (error) {
      console.error(JSON.stringify({ service: "worker", error: error instanceof Error ? error.message : "unknown" }));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

process.on("SIGINT", () => { shuttingDown = true; });
process.on("SIGTERM", () => { shuttingDown = true; });
await loop();
await redisPublisher?.close();
await postgresQueue?.close();
