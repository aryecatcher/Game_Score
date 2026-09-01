import type { Id } from "@gamechanger/contracts";
import type { ApiClient } from "../api/client.js";
import type { ScoreEventLog } from "./event-log.js";

export class ScoreSyncEngine {
  constructor(private readonly api: ApiClient, private readonly log: ScoreEventLog) {}

  async sync(gameId: Id, baseRevision: number, authorityEpoch: number): Promise<number> {
    const pending = await this.log.pending(gameId, 100);
    if (pending.length === 0) return baseRevision;
    const response = await this.api.appendScoreBatch(gameId, {
      baseRevision,
      authorityEpoch,
      rulesVersion: "draft-0.1",
      statSetVersion: "draft-unapproved",
      events: pending.map(({ gameId: _gameId, authorityEpoch: _epoch, localOrder: _localOrder, ...event }) => event)
    });
    await this.log.markSynced([...response.acceptedClientEventIds, ...response.duplicateClientEventIds]);
    return response.snapshot.revision;
  }
}
