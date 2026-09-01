import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { FIXTURE_IDS } from "../../packages/application/src/index.js";
import { loadEnvironment } from "../../packages/config/src/index.js";
import { RealtimeServerMessageSchema, type RealtimeServerMessage } from "../../packages/contracts/src/index.js";
import { createApiApp } from "../../apps/api/src/app.js";
import { createRealtimeGateway, type RealtimeGateway } from "../../apps/realtime/src/server.js";

type RunningStack = {
  api: ReturnType<typeof createApiApp>;
  apiUrl: string;
  gateway: RealtimeGateway;
  sockets: WebSocket[];
};

const stacks: RunningStack[] = [];

afterEach(async () => {
  for (const stack of stacks.splice(0)) {
    for (const socket of stack.sockets) socket.terminate();
    await stack.gateway.close();
    await stack.api.app.close();
    await stack.api.store.close?.();
  }
});

async function startStack(): Promise<RunningStack> {
  const internalServiceToken = "integration-only-service-token";
  const api = createApiApp({
    env: loadEnvironment({
      NODE_ENV: "test",
      APP_MODE: "memory",
      INTERNAL_SERVICE_TOKEN: internalServiceToken
    })
  });
  await api.app.listen({ host: "127.0.0.1", port: 0 });
  const apiAddress = api.app.server.address() as AddressInfo;
  const apiUrl = `http://127.0.0.1:${apiAddress.port}`;
  const gateway = createRealtimeGateway({
    host: "127.0.0.1",
    port: 0,
    apiInternalUrl: apiUrl,
    internalServiceToken,
    pollIntervalMs: 25,
    heartbeatIntervalMs: 5_000
  });
  await gateway.ready;
  const stack = { api, apiUrl, gateway, sockets: [] };
  stacks.push(stack);
  return stack;
}

function collect(socket: WebSocket) {
  const messages: RealtimeServerMessage[] = [];
  const waiters = new Set<() => void>();
  socket.on("message", (raw) => {
    messages.push(RealtimeServerMessageSchema.parse(JSON.parse(raw.toString())));
    for (const wake of waiters) wake();
    waiters.clear();
  });
  return async <T extends RealtimeServerMessage["type"]>(type: T, timeoutMs = 2_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = messages.find((message) => message.type === type);
      if (match) return match as Extract<RealtimeServerMessage, { type: T }>;
      await new Promise<void>((resolve, reject) => {
        const remaining = deadline - Date.now();
        const timer = setTimeout(() => {
          waiters.delete(wake);
          reject(new Error(`Timed out waiting for realtime message ${type}`));
        }, Math.max(1, remaining));
        const wake = (): void => {
          clearTimeout(timer);
          resolve();
        };
        waiters.add(wake);
      });
    }
    throw new Error(`Timed out waiting for realtime message ${type}`);
  };
}

async function connect(stack: RunningStack): Promise<{ socket: WebSocket; waitFor: ReturnType<typeof collect> }> {
  const socket = new WebSocket(stack.gateway.url());
  stack.sockets.push(socket);
  const waitFor = collect(socket);
  await once(socket, "open");
  return { socket, waitFor };
}

describe("memory API and Realtime Gateway integration", () => {
  it("delivers an accepted canonical score event to an authorized viewer", async () => {
    const stack = await startStack();
    const { socket, waitFor } = await connect(stack);
    socket.send(JSON.stringify({ type: "AUTH", token: `dev:${FIXTURE_IDS.fan}` }));
    socket.send(JSON.stringify({ type: "SUBSCRIBE_GAME", gameId: FIXTURE_IDS.game, afterSequence: 0 }));

    await waitFor("AUTH_PENDING");
    const authenticated = await waitFor("AUTHENTICATED");
    expect(authenticated.accountId).toBe(FIXTURE_IDS.fan);

    const append = await fetch(`${stack.apiUrl}/v1/games/${FIXTURE_IDS.game}/score-events:batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer dev:${FIXTURE_IDS.scorer}`
      },
      body: JSON.stringify({
        baseRevision: 0,
        authorityEpoch: 1,
        rulesVersion: "draft-0.1",
        statSetVersion: "draft-unapproved",
        events: [{
          clientEventId: "60000000-0000-4000-8000-000000000031",
          deviceId: FIXTURE_IDS.device,
          occurredAt: "2026-09-01T18:00:00.000Z",
          payload: { type: "GAME_STARTED" }
        }]
      })
    });
    expect(append.status).toBe(200);

    const realtime = await waitFor("SCORE_EVENT");
    expect(realtime.event).toMatchObject({
      gameId: FIXTURE_IDS.game,
      sequence: 1,
      clientEventId: "60000000-0000-4000-8000-000000000031",
      payload: { type: "GAME_STARTED" }
    });
  });

  it("preserves the API reason code when realtime authorization is denied", async () => {
    const stack = await startStack();
    const { socket, waitFor } = await connect(stack);
    socket.send(JSON.stringify({ type: "AUTH", token: `dev:${FIXTURE_IDS.outsider}` }));
    socket.send(JSON.stringify({ type: "SUBSCRIBE_GAME", gameId: FIXTURE_IDS.game, afterSequence: 0 }));

    const denied = await waitFor("ERROR");
    expect(denied.code).toBe("ROLE_MISSING");
  });
});
