import { createClient, type RedisClientType } from "redis";
import { ScoreEventSchema, type Id, type ScoreEvent } from "@gamechanger/contracts";

export const scoreChannel = (gameId: Id): string => `gamechanger:score:${gameId}`;

export class RedisScorePublisher {
  private readonly client: RedisClientType;
  constructor(url: string) { this.client = createClient({ url }); }
  async connect(): Promise<void> { if (!this.client.isOpen) await this.client.connect(); }
  async publish(event: ScoreEvent): Promise<void> {
    await this.connect();
    await this.client.publish(scoreChannel(event.gameId), JSON.stringify(event));
  }
  async close(): Promise<void> { if (this.client.isOpen) await this.client.quit(); }
}

export class RedisScoreSubscriber {
  private readonly client: RedisClientType;
  constructor(url: string) { this.client = createClient({ url }); }
  async connect(): Promise<void> { if (!this.client.isOpen) await this.client.connect(); }
  async subscribe(gameId: Id, listener: (event: ScoreEvent) => void): Promise<void> {
    await this.connect();
    await this.client.subscribe(scoreChannel(gameId), (message) => listener(ScoreEventSchema.parse(JSON.parse(message))));
  }
  async unsubscribe(gameId: Id): Promise<void> { if (this.client.isOpen) await this.client.unsubscribe(scoreChannel(gameId)); }
  async close(): Promise<void> { if (this.client.isOpen) await this.client.quit(); }
}
