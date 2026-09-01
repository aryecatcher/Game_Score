import { describe, expect, it } from "vitest";
import type { AppendScoreBatchRequest, Id } from "@gamechanger/contracts";
import { DomainError } from "@gamechanger/domain";
import { FIXTURE_IDS } from "./fixtures.js";
import { InMemoryPlatformStore } from "./memory-store.js";
import { ScoreService } from "./score-service.js";

function request(clientEventId: Id, authorityEpoch = 1): AppendScoreBatchRequest {
  return {
    baseRevision: 0,
    authorityEpoch,
    rulesVersion: "draft-0.1",
    statSetVersion: "draft-unapproved",
    events: [{
      clientEventId,
      deviceId: FIXTURE_IDS.device,
      occurredAt: "2026-09-01T18:00:00.000Z",
      payload: { type: "GAME_STARTED" }
    }]
  };
}

describe("ScoreService", () => {
  it("accepts retries idempotently", async () => {
    const store = new InMemoryPlatformStore();
    const service = new ScoreService(store);
    const id = "60000000-0000-4000-8000-000000000011" as Id;
    expect((await service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, request(id))).acceptedClientEventIds).toEqual([id]);
    expect((await service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, request(id))).duplicateClientEventIds).toEqual([id]);
    expect(await store.listEvents(FIXTURE_IDS.game)).toHaveLength(1);
  });

  it("quarantines a stale scorer epoch", async () => {
    const store = new InMemoryPlatformStore();
    const service = new ScoreService(store);
    await expect(service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, request("60000000-0000-4000-8000-000000000012" as Id, 99))).rejects.toThrow(DomainError);
    expect(store.quarantined).toHaveLength(1);
  });

  it("rejects a cross-team outsider", async () => {
    const service = new ScoreService(new InMemoryPlatformStore());
    await expect(service.appendBatch(FIXTURE_IDS.outsider, FIXTURE_IDS.game, request("60000000-0000-4000-8000-000000000013" as Id))).rejects.toThrow(/cannot append/);
  });

  it("fails explicitly when the rules version differs", async () => {
    const service = new ScoreService(new InMemoryPlatformStore());
    await expect(service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, {
      ...request("60000000-0000-4000-8000-000000000014" as Id),
      rulesVersion: "unknown-rules"
    })).rejects.toMatchObject({ code: "RULES_VERSION_MISMATCH" });
  });

  it("increments authority epoch on explicit handoff and quarantines old-device events", async () => {
    const store = new InMemoryPlatformStore();
    const service = new ScoreService(store);
    const authority = await service.assignScorer(FIXTURE_IDS.staff, FIXTURE_IDS.game, FIXTURE_IDS.scorer, "Device handoff");
    expect(authority.authorityEpoch).toBe(2);
    await expect(service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, request("60000000-0000-4000-8000-000000000015" as Id, 1))).rejects.toMatchObject({ code: "STALE_AUTHORITY" });
    expect(store.quarantined).toHaveLength(1);
    expect(store.audits.at(-1)?.action).toBe("SCORER_ASSIGN");
  });

  it("keeps final games immutable", async () => {
    const store = new InMemoryPlatformStore();
    const service = new ScoreService(store);
    await service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, {
      ...request("60000000-0000-4000-8000-000000000016" as Id),
      events: [{
        clientEventId: "60000000-0000-4000-8000-000000000016" as Id,
        deviceId: FIXTURE_IDS.device,
        occurredAt: "2026-09-01T19:00:00.000Z",
        payload: { type: "GAME_FINALIZED" }
      }]
    });
    await expect(service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, {
      ...request("60000000-0000-4000-8000-000000000017" as Id),
      baseRevision: 1
    })).rejects.toMatchObject({ code: "GAME_FINAL" });
  });

  it("allows only one concurrent canonical sequence", async () => {
    const store = new InMemoryPlatformStore();
    const service = new ScoreService(store);
    const results = await Promise.allSettled([
      service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, request("60000000-0000-4000-8000-000000000018" as Id)),
      service.appendBatch(FIXTURE_IDS.scorer, FIXTURE_IDS.game, request("60000000-0000-4000-8000-000000000019" as Id))
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await store.listEvents(FIXTURE_IDS.game)).toHaveLength(1);
  });
});
