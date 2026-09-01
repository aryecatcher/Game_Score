import { describe, expect, it, vi } from "vitest";
import type { GameEventsResponse, Id, RealtimeServerMessage, ScoreEvent } from "@gamechanger/contracts";
import { LiveScoreFollower, type GameFeedPort, type LiveScoreStatus } from "./live-score-follower.js";

const gameId = "20000000-0000-4000-8000-000000000001" as Id;
const accountId = "00000000-0000-4000-8000-000000000005" as Id;
const deviceId = "40000000-0000-4000-8000-000000000001" as Id;
const batterId = "30000000-0000-4000-8000-000000000001" as Id;

function event(sequence: number, payload: ScoreEvent["payload"]): ScoreEvent {
  return {
    id: `50000000-0000-4000-8000-${String(sequence).padStart(12, "0")}` as Id,
    gameId,
    clientEventId: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}` as Id,
    actorAccountId: accountId,
    deviceId,
    authorityEpoch: 1,
    sequence,
    occurredAt: `2026-09-01T18:00:0${sequence}.000Z`,
    recordedAt: `2026-09-01T18:00:0${sequence}.100Z`,
    schemaVersion: "score-event.v1",
    rulesVersion: "draft-0.1",
    statSetVersion: "draft-unapproved",
    correlationId: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}` as Id,
    payload
  };
}

class FakeFeed implements GameFeedPort {
  listener: ((message: RealtimeServerMessage) => void) | undefined;
  connect = vi.fn((_token: string, _gameId: Id, _afterSequence: number, onMessage: (message: RealtimeServerMessage) => void) => {
    this.listener = onMessage;
  });
  close = vi.fn();
  emit(message: RealtimeServerMessage): void { this.listener?.(message); }
}

describe("LiveScoreFollower", () => {
  it("replays an in-order realtime event on top of the canonical baseline", async () => {
    const first = event(1, { type: "GAME_STARTED" });
    const api = { events: vi.fn<() => Promise<GameEventsResponse>>().mockResolvedValue({ events: [first], latestSequence: 1 }) };
    const feed = new FakeFeed();
    const snapshots: Array<{ revision: number; homeRuns: number }> = [];
    const follower = new LiveScoreFollower(api, feed, "dev-token", gameId, {
      onSnapshot: (snapshot) => snapshots.push({ revision: snapshot.revision, homeRuns: snapshot.homeRuns })
    });

    await follower.start();
    const second = event(2, {
      type: "PLATE_APPEARANCE_RECORDED",
      offense: "HOME",
      batterAthleteId: batterId,
      result: "HOME_RUN",
      runs: 1,
      outs: 0,
      rbi: 1
    });
    feed.emit({ type: "SCORE_EVENT", event: second });

    expect(feed.connect).toHaveBeenCalledWith("dev-token", gameId, 1, expect.any(Function));
    expect(snapshots.at(-1)).toEqual({ revision: 2, homeRuns: 1 });
  });

  it("reloads canonical events when a sequence gap is detected", async () => {
    const first = event(1, { type: "GAME_STARTED" });
    const second = event(2, { type: "HALF_INNING_ADVANCED" });
    const api = {
      events: vi.fn<() => Promise<GameEventsResponse>>()
        .mockResolvedValueOnce({ events: [], latestSequence: 0 })
        .mockResolvedValueOnce({ events: [first, second], latestSequence: 2 })
    };
    const feed = new FakeFeed();
    const statuses: LiveScoreStatus[] = [];
    const revisions: number[] = [];
    const follower = new LiveScoreFollower(api, feed, "dev-token", gameId, {
      onSnapshot: (snapshot) => revisions.push(snapshot.revision),
      onStatus: (status) => statuses.push(status)
    });

    await follower.start();
    feed.emit({ type: "SCORE_EVENT", event: second });
    await vi.waitFor(() => expect(revisions.at(-1)).toBe(2));

    expect(api.events).toHaveBeenCalledTimes(2);
    expect(statuses).toContainEqual({ type: "RECOVERING", requestedSequence: 2 });
    expect(statuses.at(-1)).toEqual({ type: "LIVE", latestSequence: 2 });
  });
});
