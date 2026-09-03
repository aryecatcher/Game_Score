import { describe, expect, it, vi } from "vitest";
import type { AppendScoreBatchResponse, GameSnapshot, Id } from "@gamechanger/contracts";
import { ScoreSyncEngine, type ScoreSyncApi } from "./sync-engine.js";
import type { PendingScoreEvent, ScoreEventLog } from "./event-log.js";

const gameId = "20000000-0000-4000-8000-000000000001" as Id;
const deviceId = "40000000-0000-4000-8000-000000000001" as Id;

function pending(clientEventId: Id, authorityEpoch: number, localOrder: number): PendingScoreEvent {
  return {
    gameId,
    authorityEpoch,
    localOrder,
    clientEventId,
    deviceId,
    occurredAt: "2026-09-01T18:00:00.000Z",
    payload: { type: "GAME_STARTED" }
  };
}

function response(revision: number, acceptedClientEventIds: Id[]): AppendScoreBatchResponse {
  const snapshot: GameSnapshot = {
    gameId,
    revision,
    status: "LIVE",
    inning: 1,
    half: "TOP",
    outs: 0,
    homeRuns: 0,
    awayRuns: 0,
    batterLines: [],
    updatedAt: "2026-09-01T18:00:00.000Z"
  };
  return { acceptedClientEventIds, duplicateClientEventIds: [], quarantinedClientEventIds: [], rebased: false, snapshot };
}

describe("ScoreSyncEngine", () => {
  it("preserves the authority epoch recorded with an offline event", async () => {
    const firstId = "60000000-0000-4000-8000-000000000041" as Id;
    const secondId = "60000000-0000-4000-8000-000000000042" as Id;
    const markSynced = vi.fn<ScoreEventLog["markSynced"]>();
    const log: ScoreEventLog = {
      append: vi.fn<ScoreEventLog["append"]>(),
      pending: vi.fn<ScoreEventLog["pending"]>().mockResolvedValue([
        pending(secondId, 2, 2),
        pending(firstId, 1, 1)
      ]),
      markSynced
    };
    const appendScoreBatch = vi.fn<ScoreSyncApi["appendScoreBatch"]>().mockResolvedValue(response(1, [firstId]));
    const engine = new ScoreSyncEngine({ appendScoreBatch }, log);

    await expect(engine.sync(gameId, 0)).resolves.toBe(1);

    expect(appendScoreBatch).toHaveBeenCalledWith(gameId, expect.objectContaining({
      authorityEpoch: 1,
      events: [expect.objectContaining({ clientEventId: firstId })]
    }));
    expect(markSynced).toHaveBeenCalledWith([firstId]);
  });
});
