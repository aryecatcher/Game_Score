import { describe, expect, it } from "vitest";
import type { Id, ScoreEvent } from "@gamechanger/contracts";
import { projectScore } from "./scoring.js";

const gameId = "20000000-0000-4000-8000-000000000001" as Id;
const batterId = "30000000-0000-4000-8000-000000000001" as Id;
const common = {
  gameId,
  actorAccountId: "00000000-0000-4000-8000-000000000002" as Id,
  deviceId: "40000000-0000-4000-8000-000000000001" as Id,
  authorityEpoch: 1,
  occurredAt: "2026-01-01T00:00:00.000Z",
  recordedAt: "2026-01-01T00:00:00.000Z",
  schemaVersion: "score-event.v1",
  rulesVersion: "draft-0.1",
  statSetVersion: "draft-unapproved",
  correlationId: "80000000-0000-4000-8000-000000000001" as Id
};

describe("score projection", () => {
  it("replays the same canonical event log deterministically", () => {
    const events: ScoreEvent[] = [
      { ...common, id: "50000000-0000-4000-8000-000000000001" as Id, clientEventId: "60000000-0000-4000-8000-000000000001" as Id, sequence: 1, payload: { type: "GAME_STARTED" } },
      { ...common, id: "50000000-0000-4000-8000-000000000002" as Id, clientEventId: "60000000-0000-4000-8000-000000000002" as Id, sequence: 2, payload: { type: "PLATE_APPEARANCE_RECORDED", offense: "HOME", batterAthleteId: batterId, result: "HOME_RUN", runs: 1, outs: 0, rbi: 1 } }
    ];
    expect(projectScore(gameId, events)).toEqual(projectScore(gameId, [...events].reverse()));
    expect(projectScore(gameId, events)).toMatchObject({ homeRuns: 1, awayRuns: 0, revision: 2 });
  });

  it("applies correction as a new event without mutating history", () => {
    const targetId = "60000000-0000-4000-8000-000000000003" as Id;
    const events: ScoreEvent[] = [
      { ...common, id: "50000000-0000-4000-8000-000000000003" as Id, clientEventId: targetId, sequence: 1, payload: { type: "PLATE_APPEARANCE_RECORDED", offense: "AWAY", batterAthleteId: batterId, result: "HOME_RUN", runs: 1, outs: 0, rbi: 1 } },
      { ...common, id: "50000000-0000-4000-8000-000000000004" as Id, clientEventId: "60000000-0000-4000-8000-000000000004" as Id, sequence: 2, payload: { type: "CORRECTION_APPLIED", targetClientEventId: targetId, replacement: { type: "PLATE_APPEARANCE_RECORDED", offense: "AWAY", batterAthleteId: batterId, result: "OUT", runs: 0, outs: 1, rbi: 0 }, reason: "Official scorer corrected the ruling" } }
    ];
    expect(projectScore(gameId, events)).toMatchObject({ awayRuns: 0, outs: 1, revision: 2 });
    expect(events[0]?.payload.type).toBe("PLATE_APPEARANCE_RECORDED");
  });
});
