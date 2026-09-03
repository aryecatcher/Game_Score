import type { AppendScoreBatchRequest, AppendScoreBatchResponse, Id } from "@gamechanger/contracts";
import type { PendingScoreEvent, ScoreEventLog } from "./event-log.js";

export interface ScoreSyncApi {
  appendScoreBatch(gameId: Id, request: AppendScoreBatchRequest): Promise<AppendScoreBatchResponse>;
}

export class ScoreSyncEngine {
  constructor(private readonly api: ScoreSyncApi, private readonly log: ScoreEventLog) {}

  async sync(gameId: Id, baseRevision: number): Promise<number> {
    const pending = [...await this.log.pending(gameId, 100)].sort((left, right) => left.localOrder - right.localOrder);
    const first = pending[0];
    if (!first) return baseRevision;
    const authorityEpoch = first.authorityEpoch;
    const batch: PendingScoreEvent[] = [];
    for (const event of pending) {
      if (event.authorityEpoch !== authorityEpoch) break;
      batch.push(event);
    }
    const response = await this.api.appendScoreBatch(gameId, {
      baseRevision,
      authorityEpoch,
      rulesVersion: "draft-0.1",
      statSetVersion: "draft-unapproved",
      events: batch.map(({ gameId: _gameId, authorityEpoch: _epoch, localOrder: _localOrder, ...event }) => event)
    });
    await this.log.markSynced([...response.acceptedClientEventIds, ...response.duplicateClientEventIds]);
    return response.snapshot.revision;
  }
}
