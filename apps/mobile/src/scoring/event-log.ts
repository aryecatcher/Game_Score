import type { Id, ScoreEventInput } from "@gamechanger/contracts";
import NativeScoreEventStore from "../../specs/NativeScoreEventStore.js";

export interface PendingScoreEvent extends ScoreEventInput {
  gameId: Id;
  authorityEpoch: number;
  localOrder: number;
}

export interface ScoreEventLog {
  append(event: PendingScoreEvent): Promise<void>;
  pending(gameId: Id, limit: number): Promise<PendingScoreEvent[]>;
  markSynced(clientEventIds: Id[]): Promise<void>;
}

export class HybridScoreEventLog implements ScoreEventLog {
  private readonly memory: PendingScoreEvent[] = [];

  async append(event: PendingScoreEvent): Promise<void> {
    if (NativeScoreEventStore) return NativeScoreEventStore.appendEvent(JSON.stringify(event));
    this.memory.push(event);
  }

  async pending(gameId: Id, limit: number): Promise<PendingScoreEvent[]> {
    if (NativeScoreEventStore) return JSON.parse(await NativeScoreEventStore.listPendingEvents(gameId, limit)) as PendingScoreEvent[];
    return this.memory.filter((event) => event.gameId === gameId).slice(0, limit);
  }

  async markSynced(clientEventIds: Id[]): Promise<void> {
    if (NativeScoreEventStore) return NativeScoreEventStore.markEventsSynced(JSON.stringify(clientEventIds));
    for (let index = this.memory.length - 1; index >= 0; index -= 1) {
      if (clientEventIds.includes(this.memory[index]!.clientEventId)) this.memory.splice(index, 1);
    }
  }
}
