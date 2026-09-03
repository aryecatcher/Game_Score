import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import {
  AppendScoreBatchRequestSchema,
  AssignScorerRequestSchema,
  BootstrapResponseSchema,
  GameEventsResponseSchema,
  GameSnapshotSchema,
  IdSchema,
  StartStreamRequestSchema,
  type Id
} from "@gamechanger/contracts";
import { loadEnvironment, type Environment } from "@gamechanger/config";
import { authorize, DomainError, projectScore, type Account } from "@gamechanger/domain";
import {
  bearerToken,
  DevIdentityProvider,
  FIXTURE_IDS,
  InMemoryPlatformStore,
  MockVideoProvider,
  PlaybackService,
  ScoreService,
  StreamService,
  type IdentityProvider,
  type PlatformStore,
  type VideoProvider
} from "@gamechanger/application";
import { OidcIdentityProvider, PostgresPlatformStore } from "@gamechanger/infrastructure";

export interface ApiAppOptions {
  env?: Environment;
  store?: PlatformStore;
  identity?: IdentityProvider;
  videoProvider?: VideoProvider;
}

type IdParams = { gameId: string };

function requestToken(request: FastifyRequest): string | undefined {
  return bearerToken(request.headers.authorization);
}

function internalToken(request: FastifyRequest): string | undefined {
  const value = request.headers["x-internal-service-token"];
  return Array.isArray(value) ? value[0] : value;
}

export function createApiApp(options: ApiAppOptions = {}): { app: FastifyInstance; store: PlatformStore; env: Environment } {
  const env = options.env ?? loadEnvironment();
  const store = options.store ?? (env.APP_MODE === "postgres"
    ? new PostgresPlatformStore(env.DATABASE_URL!)
    : new InMemoryPlatformStore({
    regionCode: env.POLICY_REGION_CODE,
    policyVersion: env.POLICY_VERSION,
    accountMinAge: env.ACCOUNT_MIN_AGE ?? null,
    guardianConsentMode: env.GUARDIAN_CONSENT_MODE
  }));
  const identity = options.identity ?? (env.AUTH_PROVIDER === "oidc"
    ? new OidcIdentityProvider(env.OIDC_ISSUER!, env.OIDC_AUDIENCE!, store)
    : new DevIdentityProvider());
  if (!options.videoProvider && env.VIDEO_PROVIDER !== "mock") {
    throw new Error(`VIDEO_PROVIDER=${env.VIDEO_PROVIDER} was selected, but its credentialed adapter has not been approved and injected.`);
  }
  const videoProvider = options.videoProvider ?? new MockVideoProvider();
  const scoreService = new ScoreService(store, { rulesVersion: env.BASEBALL_RULES_VERSION, statSetVersion: env.OFFICIAL_STAT_SET_VERSION });
  const streamService = new StreamService(store, videoProvider);
  const playbackService = new PlaybackService(store, videoProvider);
  const app = Fastify({ logger: env.NODE_ENV !== "test" ? { level: env.LOG_LEVEL } : false, genReqId: () => crypto.randomUUID() });

  const authenticateAccount = async (request: FastifyRequest): Promise<Account> => {
    const accountId = await identity.authenticate(requestToken(request));
    const account = await store.getAccount(accountId);
    if (!account || account.status !== "ACTIVE") {
      throw new DomainError("UNAUTHENTICATED", "Account is not active in this pilot.", 401);
    }
    return account;
  };
  const authenticate = async (request: FastifyRequest): Promise<Id> => (await authenticateAccount(request)).id;
  const pilotTeamId = (env.PILOT_TEAM_ID ?? FIXTURE_IDS.team) as Id;
  const pilotGameId = (env.PILOT_GAME_ID ?? FIXTURE_IDS.game) as Id;
  const verifyInternal = (request: FastifyRequest): void => {
    if (internalToken(request) !== env.INTERNAL_SERVICE_TOKEN) throw new DomainError("UNAUTHENTICATED", "Invalid internal service token.", 401);
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Request validation failed.", requestId: request.id, details: { issues: error.issues } } });
    }
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details ? { details: error.details } : {})
        }
      });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error.", requestId: request.id } });
  });

  app.get("/health", async () => ({ status: "ok", mode: env.APP_MODE, databaseConnected: env.APP_MODE === "postgres", videoProvider: videoProvider.name }));

  app.get("/v1/bootstrap", async (request) => {
    const account = await authenticateAccount(request);
    const accountId = account.id;
    const grants = (await store.listGrants(accountId)).filter((grant) => {
      if (grant.status !== "ACTIVE") return false;
      if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return false;
      if (grant.scopeType === "PLATFORM") return grant.role === "PLATFORM_ADMIN";
      if (grant.scopeType === "TEAM") return grant.scopeId === pilotTeamId;
      return grant.scopeId === pilotGameId;
    });
    if (grants.length === 0) throw new DomainError("ROLE_MISSING", "Account is not assigned to this pilot.", 403);
    const game = await store.getGame(pilotGameId);
    const team = await store.getTeam(pilotTeamId);
    if (!team || !game) throw new DomainError("NOT_FOUND", "Pilot team or game configuration was not found.", 404);
    return BootstrapResponseSchema.parse({
      account,
      grants,
      policy: await store.policy(),
      pilot: {
        team,
        game,
        athletes: await store.listAthletes(pilotTeamId),
        authority: await store.getAuthority(pilotGameId),
        snapshot: projectScore(pilotGameId, await store.listEvents(pilotGameId))
      }
    });
  });

  app.get<{ Params: IdParams; Querystring: { afterSequence?: string } }>("/v1/games/:gameId/events", async (request) => {
    const accountId = await authenticate(request);
    const gameId = IdSchema.parse(request.params.gameId);
    const game = await store.getGame(gameId);
    if (!game) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
    const decision = authorize({ accountId, action: "PLAYBACK_AUTHORIZE", game, grants: await store.listGrants(accountId), membershipActive: true, consentSatisfied: true });
    if (!decision.allowed) throw new DomainError(decision.reason, "Game events are not authorized.", 403);
    const after = request.query.afterSequence ? z.coerce.number().int().nonnegative().parse(request.query.afterSequence) : 0;
    const allEvents = await store.listEvents(gameId);
    return GameEventsResponseSchema.parse({ events: allEvents.filter((event) => event.sequence > after), latestSequence: allEvents.at(-1)?.sequence ?? 0 });
  });

  app.get<{ Params: IdParams }>("/v1/games/:gameId/snapshot", async (request) => {
    const accountId = await authenticate(request);
    const gameId = IdSchema.parse(request.params.gameId);
    const game = await store.getGame(gameId);
    if (!game) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
    const decision = authorize({ accountId, action: "PLAYBACK_AUTHORIZE", game, grants: await store.listGrants(accountId), membershipActive: true, consentSatisfied: true });
    if (!decision.allowed) throw new DomainError(decision.reason, "Snapshot is not authorized.", 403);
    return GameSnapshotSchema.parse(projectScore(gameId, await store.listEvents(gameId)));
  });

  app.post<{ Params: IdParams }>("/v1/games/:gameId/score-events:batch", async (request) => {
    const accountId = await authenticate(request);
    return scoreService.appendBatch(accountId, IdSchema.parse(request.params.gameId), AppendScoreBatchRequestSchema.parse(request.body));
  });

  app.post<{ Params: IdParams }>("/v1/games/:gameId/scorer-authority", async (request) => {
    const accountId = await authenticate(request);
    const body = AssignScorerRequestSchema.parse(request.body);
    return scoreService.assignScorer(accountId, IdSchema.parse(request.params.gameId), body.accountId, body.reason);
  });

  app.post<{ Params: IdParams }>("/v1/games/:gameId/stream-sessions", async (request) => {
    const accountId = await authenticate(request);
    StartStreamRequestSchema.parse(request.body);
    return streamService.start(accountId, IdSchema.parse(request.params.gameId));
  });

  app.post<{ Params: IdParams }>("/v1/games/:gameId/playback-authorizations", async (request) => {
    const accountId = await authenticate(request);
    return playbackService.authorize(accountId, IdSchema.parse(request.params.gameId));
  });

  app.get("/v1/offers", async (request) => {
    await authenticate(request);
    return {
      offers: [{ id: "personal-draft", name: "Personal subscription (draft)", price: null, currency: null, researchPriceText: null, experimentId: "pilot-pricing-placeholder", purchasable: false }]
    };
  });

  app.get("/v1/me/entitlements", async (request) => {
    const accountId = await authenticate(request);
    return {
      accountId,
      provider: "pilot-grant",
      videoQuotaMinutes: env.FREE_VIDEO_QUOTA_MINUTES ?? null,
      quotaStatus: env.FREE_VIDEO_QUOTA_MINUTES ? "ACTIVE" : "NOT_CONFIGURED",
      storePurchasesEnabled: false
    };
  });

  app.post<{ Body: { token?: string; gameId?: string } }>("/internal/realtime/authorize", async (request) => {
    verifyInternal(request);
    const token = z.string().min(1).parse(request.body?.token);
    const gameId = IdSchema.parse(request.body?.gameId);
    const accountId = await identity.authenticate(token);
    const game = await store.getGame(gameId);
    if (!game) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
    const decision = authorize({ accountId, action: "PLAYBACK_AUTHORIZE", game, grants: await store.listGrants(accountId), membershipActive: true, consentSatisfied: true });
    if (!decision.allowed) throw new DomainError(decision.reason, "Realtime subscription is not authorized.", 403);
    return { allowed: true as const, accountId };
  });

  app.get<{ Params: IdParams; Querystring: { afterSequence?: string } }>("/internal/realtime/games/:gameId/events", async (request) => {
    verifyInternal(request);
    const gameId = IdSchema.parse(request.params.gameId);
    const after = request.query.afterSequence ? z.coerce.number().int().nonnegative().parse(request.query.afterSequence) : 0;
    const allEvents = await store.listEvents(gameId);
    return GameEventsResponseSchema.parse({ events: allEvents.filter((event) => event.sequence > after), latestSequence: allEvents.at(-1)?.sequence ?? 0 });
  });

  app.get<{ Querystring: { limit?: string } }>("/internal/outbox", async (request) => {
    verifyInternal(request);
    const limit = request.query.limit ? z.coerce.number().int().min(1).max(100).parse(request.query.limit) : 25;
    return { events: await store.listOutbox(limit) };
  });

  app.post<{ Params: { id: string } }>("/internal/outbox/:id/ack", async (request) => {
    verifyInternal(request);
    const acknowledged = await store.acknowledgeOutbox(IdSchema.parse(request.params.id));
    if (!acknowledged) throw new DomainError("NOT_FOUND", "Outbox event was not found.", 404);
    return { acknowledged: true };
  });

  return { app, store, env };
}
