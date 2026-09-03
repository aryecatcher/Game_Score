import { afterEach, describe, expect, it } from "vitest";
import type { Id } from "@gamechanger/contracts";
import { loadEnvironment } from "@gamechanger/config";
import { FIXTURE_IDS, InMemoryPlatformStore, type PlatformStore } from "@gamechanger/application";
import type { RoleGrant } from "@gamechanger/domain";
import { createApiApp } from "./app.js";

const apps: Array<ReturnType<typeof createApiApp>["app"]> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function build(store?: PlatformStore) {
  const result = createApiApp({
    env: loadEnvironment({ NODE_ENV: "test", APP_MODE: "memory", INTERNAL_SERVICE_TOKEN: "test-internal-token" }),
    ...(store ? { store } : {})
  });
  apps.push(result.app);
  return result;
}

class SuspendedAccountStore extends InMemoryPlatformStore {
  override async getAccount(id: Id) {
    const account = await super.getAccount(id);
    return account && id === FIXTURE_IDS.fan ? { ...account, status: "SUSPENDED" as const } : account;
  }
}

class CrossScopeGrantStore extends InMemoryPlatformStore {
  override async listGrants(accountId: Id): Promise<RoleGrant[]> {
    if (accountId !== FIXTURE_IDS.outsider) return super.listGrants(accountId);
    return [{
      id: "90000000-0000-4000-8000-000000000099" as Id,
      accountId,
      role: "APPROVED_FAN",
      scopeType: "TEAM",
      scopeId: "10000000-0000-4000-8000-000000000099" as Id,
      status: "ACTIVE"
    }];
  }
}

describe("MVP API", () => {
  it("exposes synthetic pilot bootstrap only to authenticated members", async () => {
    const { app } = build();
    const response = await app.inject({ method: "GET", url: "/v1/bootstrap", headers: { authorization: `Bearer dev:${FIXTURE_IDS.guardian}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().pilot.athletes[0].loginEnabled).toBe(false);
  });

  it("completes the score append and snapshot path", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "POST",
      url: `/v1/games/${FIXTURE_IDS.game}/score-events:batch`,
      headers: { authorization: `Bearer dev:${FIXTURE_IDS.scorer}` },
      payload: {
        baseRevision: 0,
        authorityEpoch: 1,
        rulesVersion: "draft-0.1",
        statSetVersion: "draft-unapproved",
        events: [{
          clientEventId: "60000000-0000-4000-8000-000000000021",
          deviceId: FIXTURE_IDS.device,
          occurredAt: "2026-09-01T18:00:00.000Z",
          payload: { type: "GAME_STARTED" }
        }]
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().snapshot).toMatchObject({ status: "LIVE", revision: 1 });
  });

  it("keeps subscription offer non-purchasable", async () => {
    const { app } = build();
    const response = await app.inject({ method: "GET", url: "/v1/offers", headers: { authorization: `Bearer dev:${FIXTURE_IDS.fan}` } });
    expect(response.json().offers[0]).toMatchObject({ purchasable: false, price: null });
  });

  it("denies an unassigned account before returning pilot bootstrap data", async () => {
    const { app } = build();
    const response = await app.inject({ method: "GET", url: "/v1/bootstrap", headers: { authorization: `Bearer dev:${FIXTURE_IDS.outsider}` } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ROLE_MISSING");
  });

  it("denies a suspended account even when a dev token and active grant exist", async () => {
    const { app } = build(new SuspendedAccountStore());
    const response = await app.inject({ method: "GET", url: "/v1/offers", headers: { authorization: `Bearer dev:${FIXTURE_IDS.fan}` } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("does not expose the pilot bootstrap to an account granted on another team", async () => {
    const { app } = build(new CrossScopeGrantStore());
    const response = await app.inject({ method: "GET", url: "/v1/bootstrap", headers: { authorization: `Bearer dev:${FIXTURE_IDS.outsider}` } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ROLE_MISSING");
  });

  it("starts a mock stream only for the delegated role and authorizes an approved fan", async () => {
    const { app } = build();
    const started = await app.inject({
      method: "POST",
      url: `/v1/games/${FIXTURE_IDS.game}/stream-sessions`,
      headers: { authorization: `Bearer dev:${FIXTURE_IDS.videographer}` },
      payload: { idempotencyKey: "a0000000-0000-4000-8000-000000000001", requestedQuality: "720p" }
    });
    expect(started.statusCode).toBe(200);
    const playback = await app.inject({ method: "POST", url: `/v1/games/${FIXTURE_IDS.game}/playback-authorizations`, headers: { authorization: `Bearer dev:${FIXTURE_IDS.fan}` }, payload: {} });
    expect(playback.statusCode).toBe(200);
    expect(playback.json()).toMatchObject({ expiresInSeconds: 120 });
  });

  it("does not create a new stream after a game is final", async () => {
    const { app } = build();
    const finalized = await app.inject({
      method: "POST",
      url: `/v1/games/${FIXTURE_IDS.game}/score-events:batch`,
      headers: { authorization: `Bearer dev:${FIXTURE_IDS.scorer}` },
      payload: {
        baseRevision: 0,
        authorityEpoch: 1,
        rulesVersion: "draft-0.1",
        statSetVersion: "draft-unapproved",
        events: [{
          clientEventId: "60000000-0000-4000-8000-000000000029",
          deviceId: FIXTURE_IDS.device,
          occurredAt: "2026-09-01T20:00:00.000Z",
          payload: { type: "GAME_FINALIZED" }
        }]
      }
    });
    expect(finalized.statusCode).toBe(200);

    const stream = await app.inject({
      method: "POST",
      url: `/v1/games/${FIXTURE_IDS.game}/stream-sessions`,
      headers: { authorization: `Bearer dev:${FIXTURE_IDS.videographer}` },
      payload: { idempotencyKey: "a0000000-0000-4000-8000-000000000029", requestedQuality: "720p" }
    });
    expect(stream.statusCode).toBe(409);
    expect(stream.json().error.code).toBe("GAME_FINAL");
  });
});
