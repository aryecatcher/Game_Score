import { type AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  ApiErrorSchema,
  GameEventsResponseSchema,
  RealtimeAuthorizationResponseSchema,
  RealtimeClientMessageSchema,
  type Id,
  type RealtimeServerMessage,
  type ScoreEvent
} from "@gamechanger/contracts";

export interface RealtimeScoreSubscriber {
  subscribe(gameId: Id, listener: (event: ScoreEvent) => void): Promise<void>;
  unsubscribe(gameId: Id): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeGatewayOptions {
  host: string;
  port: number;
  apiInternalUrl: string;
  internalServiceToken: string;
  redisSubscriber?: RealtimeScoreSubscriber;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

type ClientState = {
  token?: string;
  accountId?: Id;
  gameId?: Id;
  lastSequence: number;
  poll: NodeJS.Timeout | undefined;
  alive: boolean;
};

export interface RealtimeGateway {
  readonly server: WebSocketServer;
  readonly ready: Promise<void>;
  url(): string;
  close(): Promise<void>;
}

export function createRealtimeGateway(options: RealtimeGatewayOptions): RealtimeGateway {
  const states = new WeakMap<WebSocket, ClientState>();
  const viewers = new Map<Id, Set<WebSocket>>();
  const server = new WebSocketServer({ host: options.host, port: options.port, maxPayload: 32 * 1024 });
  const pollIntervalMs = options.pollIntervalMs ?? 750;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  let closed = false;

  const ready = new Promise<void>((resolve, reject) => {
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
  });

  const send = (socket: WebSocket, message: RealtimeServerMessage): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 512 * 1024) {
      socket.close(1013, "client is too slow");
      return;
    }
    socket.send(JSON.stringify(message));
  };

  const internalRequest = (path: string, init?: RequestInit): Promise<Response> => fetch(`${options.apiInternalUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-service-token": options.internalServiceToken,
      ...(init?.headers ?? {})
    }
  });

  const poll = async (socket: WebSocket): Promise<void> => {
    const state = states.get(socket);
    if (!state?.gameId || !state.accountId || socket.readyState !== WebSocket.OPEN) return;
    const response = await internalRequest(`/internal/realtime/games/${state.gameId}/events?afterSequence=${state.lastSequence}`);
    if (!response.ok) throw new Error(`Realtime poll failed with ${response.status}`);
    const body = GameEventsResponseSchema.parse(await response.json());
    const first = body.events[0];
    if (first && first.sequence > state.lastSequence + 1) {
      send(socket, { type: "SNAPSHOT_REQUIRED", gameId: state.gameId, latestSequence: body.latestSequence });
      if (state.poll) clearInterval(state.poll);
      state.poll = undefined;
      return;
    }
    for (const event of body.events) {
      if (event.sequence <= state.lastSequence) continue;
      send(socket, { type: "SCORE_EVENT", event });
      state.lastSequence = event.sequence;
    }
  };

  const leaveGame = async (socket: WebSocket): Promise<void> => {
    const state = states.get(socket);
    if (!state?.gameId) return;
    const gameId = state.gameId;
    const group = viewers.get(gameId);
    group?.delete(socket);
    delete state.gameId;
    if (group?.size === 0) {
      viewers.delete(gameId);
      await options.redisSubscriber?.unsubscribe(gameId);
    }
  };

  const joinRedisGame = async (socket: WebSocket, gameId: Id): Promise<void> => {
    await leaveGame(socket);
    let group = viewers.get(gameId);
    if (!group) {
      group = new Set<WebSocket>();
      viewers.set(gameId, group);
      await options.redisSubscriber!.subscribe(gameId, (event) => {
        for (const viewer of viewers.get(gameId) ?? []) {
          const viewerState = states.get(viewer);
          if (!viewerState) continue;
          if (event.sequence > viewerState.lastSequence + 1) {
            send(viewer, { type: "SNAPSHOT_REQUIRED", gameId, latestSequence: event.sequence });
            continue;
          }
          if (event.sequence <= viewerState.lastSequence) continue;
          send(viewer, { type: "SCORE_EVENT", event });
          viewerState.lastSequence = event.sequence;
        }
      });
    }
    group.add(socket);
  };

  server.on("connection", (socket) => {
    const state: ClientState = { lastSequence: 0, poll: undefined, alive: true };
    states.set(socket, state);
    socket.on("pong", () => { state.alive = true; });

    socket.on("message", async (raw) => {
      try {
        const message = RealtimeClientMessageSchema.parse(JSON.parse(raw.toString()));
        if (message.type === "PING") {
          send(socket, { type: "PONG", at: new Date().toISOString() });
          return;
        }
        if (message.type === "AUTH") {
          state.token = message.token;
          send(socket, { type: "AUTH_PENDING" });
          return;
        }
        if (!state.token) {
          send(socket, { type: "ERROR", code: "UNAUTHENTICATED", message: "Send AUTH before SUBSCRIBE_GAME." });
          return;
        }
        const response = await internalRequest("/internal/realtime/authorize", {
          method: "POST",
          body: JSON.stringify({ token: state.token, gameId: message.gameId })
        });
        if (!response.ok) {
          const body: unknown = await response.json();
          const parsed = ApiErrorSchema.safeParse(body);
          send(socket, {
            type: "ERROR",
            code: parsed.success ? parsed.data.error.code : "ROLE_MISSING",
            message: parsed.success ? parsed.data.error.message : "Realtime subscription was denied."
          });
          return;
        }
        const authorized = RealtimeAuthorizationResponseSchema.parse(await response.json());
        state.accountId = authorized.accountId;
        state.lastSequence = message.afterSequence;
        if (state.poll) clearInterval(state.poll);
        if (options.redisSubscriber) await joinRedisGame(socket, message.gameId);
        state.gameId = message.gameId;
        send(socket, { type: "AUTHENTICATED", accountId: state.accountId });
        if (!options.redisSubscriber) {
          await poll(socket);
          state.poll = setInterval(() => void poll(socket).catch(() => send(socket, {
            type: "ERROR",
            code: "INTERNAL_ERROR",
            message: "Realtime source is temporarily unavailable."
          })), pollIntervalMs);
        }
      } catch {
        send(socket, { type: "ERROR", code: "VALIDATION_ERROR", message: "Invalid realtime message." });
      }
    });

    socket.on("close", () => {
      if (state.poll) clearInterval(state.poll);
      void leaveGame(socket);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of server.clients) {
      const state = states.get(socket);
      if (!state?.alive) {
        socket.terminate();
        continue;
      }
      state.alive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);

  return {
    server,
    ready,
    url(): string {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Realtime Gateway is not listening on a TCP address.");
      return `ws://${options.host}:${(address as AddressInfo).port}`;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const socket of server.clients) {
        const state = states.get(socket);
        if (state?.poll) clearInterval(state.poll);
        socket.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await options.redisSubscriber?.close();
    }
  };
}
