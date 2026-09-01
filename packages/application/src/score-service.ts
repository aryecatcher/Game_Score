import { randomUUID } from "node:crypto";
import type { AppendScoreBatchRequest, AppendScoreBatchResponse, Id, ScoreEvent } from "@gamechanger/contracts";
import { authorize, DomainError, projectScore, stableEventFingerprint, type AuditLog, type OutboxEvent, type ScorerAuthority } from "@gamechanger/domain";
import type { PlatformStore } from "./memory-store.js";

export class ScoreService {
  constructor(
    private readonly store: PlatformStore,
    private readonly versions = { rulesVersion: "draft-0.1", statSetVersion: "draft-unapproved" },
    private readonly now = () => new Date()
  ) {}

  async appendBatch(accountId: Id, gameId: Id, request: AppendScoreBatchRequest): Promise<AppendScoreBatchResponse> {
    const game = await this.store.getGame(gameId);
    if (!game) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
    if (request.rulesVersion !== this.versions.rulesVersion) throw new DomainError("RULES_VERSION_MISMATCH", "Baseball rules version does not match the server.", 409, { expected: this.versions.rulesVersion });
    if (request.statSetVersion !== this.versions.statSetVersion) throw new DomainError("STAT_SET_VERSION_MISMATCH", "Official stat set version does not match the server.", 409, { expected: this.versions.statSetVersion });
    const decision = authorize({ accountId, action: "SCORE_EVENT_APPEND", game, grants: await this.store.listGrants(accountId) });
    if (!decision.allowed) throw new DomainError(decision.reason, "Account cannot append official score events.", 403);
    if (game.status === "FINAL") throw new DomainError("GAME_FINAL", "Final games reject ordinary score events.", 409);

    const authority = await this.store.getAuthority(gameId);
    if (!authority || authority.accountId !== accountId || authority.authorityEpoch !== request.authorityEpoch || authority.status !== "ACTIVE") {
      await this.store.quarantine(request.events, gameId, accountId, request.authorityEpoch);
      throw new DomainError("STALE_AUTHORITY", "Scorer authority is stale; events were quarantined for staff review.", 409, {
        expectedEpoch: authority?.authorityEpoch ?? null,
        receivedEpoch: request.authorityEpoch
      });
    }

    const existing = await this.store.listEvents(gameId);
    const currentRevision = existing.at(-1)?.sequence ?? 0;
    if (request.baseRevision > currentRevision) {
      throw new DomainError("REVISION_CONFLICT", "Client revision is ahead of the server.", 409, { currentRevision });
    }

    const accepted: ScoreEvent[] = [];
    const duplicates: Id[] = [];
    const now = this.now().toISOString();
    for (const input of request.events) {
      const duplicate = existing.find((item) => item.clientEventId === input.clientEventId) ?? accepted.find((item) => item.clientEventId === input.clientEventId);
      if (duplicate) {
        if (stableEventFingerprint(duplicate) !== stableEventFingerprint(input)) {
          throw new DomainError("DUPLICATE_REQUEST", "clientEventId was reused with different event content.", 409, { clientEventId: input.clientEventId });
        }
        duplicates.push(input.clientEventId);
        continue;
      }
      if (input.payload.type === "CORRECTION_APPLIED") {
        const targetClientEventId = input.payload.targetClientEventId;
        const target = existing.find((item) => item.clientEventId === targetClientEventId) ?? accepted.find((item) => item.clientEventId === targetClientEventId);
        if (!target) throw new DomainError("TARGET_EVENT_MISSING", "Correction target does not exist in this game.", 409);
        if (target.payload.type === "CORRECTION_APPLIED") throw new DomainError("TARGET_EVENT_MISSING", "Corrections must target a score mutation, not another correction.", 409);
      }
      accepted.push({
        ...input,
        id: randomUUID() as Id,
        gameId,
        actorAccountId: accountId,
        authorityEpoch: request.authorityEpoch,
        sequence: currentRevision + accepted.length + 1,
        recordedAt: now,
        schemaVersion: "score-event.v1",
        rulesVersion: request.rulesVersion,
        statSetVersion: request.statSetVersion,
        correlationId: input.clientEventId
      });
    }

    if (accepted.some((event, index) => event.payload.type === "GAME_FINALIZED" && index !== accepted.length - 1)) {
      throw new DomainError("GAME_FINAL", "GAME_FINALIZED must be the final event in a batch.", 409);
    }
    const audit: AuditLog[] = accepted.map((event) => ({
      id: randomUUID() as Id,
      actorAccountId: accountId,
      action: event.payload.type === "CORRECTION_APPLIED" ? "SCORE_CORRECT" : "SCORE_EVENT_APPEND",
      scopeType: "GAME",
      scopeId: gameId,
      ...(event.payload.type === "CORRECTION_APPLIED" ? { reason: event.payload.reason } : {}),
      metadata: { clientEventId: event.clientEventId, sequence: event.sequence, authorityEpoch: event.authorityEpoch },
      recordedAt: now
    }));
    const outbox: OutboxEvent[] = accepted.map((event) => ({
      id: randomUUID() as Id,
      aggregateType: "GAME",
      aggregateId: gameId,
      eventType: "score.event.recorded",
      payload: { event },
      recordedAt: now,
      processedAt: null,
      attempts: 0
    }));
    const snapshot = accepted.length > 0
      ? await this.store.appendScoreTransaction(accepted, audit, outbox)
      : projectScore(gameId, existing);
    return {
      acceptedClientEventIds: accepted.map((event) => event.clientEventId),
      duplicateClientEventIds: duplicates,
      quarantinedClientEventIds: [],
      rebased: request.baseRevision < currentRevision,
      snapshot
    };
  }

  async assignScorer(actorAccountId: Id, gameId: Id, nextAccountId: Id, reason: string): Promise<ScorerAuthority> {
    const game = await this.store.getGame(gameId);
    if (!game) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
    const decision = authorize({ accountId: actorAccountId, action: "SCORER_ASSIGN", game, grants: await this.store.listGrants(actorAccountId) });
    if (!decision.allowed) throw new DomainError(decision.reason, "Account cannot assign the scorer.", 403);
    if (!reason.trim()) throw new DomainError("REASON_REQUIRED", "Authority handoff requires a reason.");
    if (!await this.store.getAccount(nextAccountId)) throw new DomainError("NOT_FOUND", "Target scorer account was not found.", 404);
    const targetDecision = authorize({ accountId: nextAccountId, action: "SCORE_EVENT_APPEND", game, grants: await this.store.listGrants(nextAccountId) });
    if (!targetDecision.allowed) throw new DomainError(targetDecision.reason, "Target account does not hold the official scorer role for this game.", 409);
    const previous = await this.store.getAuthority(gameId);
    const authority: ScorerAuthority = {
      gameId,
      accountId: nextAccountId,
      authorityEpoch: (previous?.authorityEpoch ?? 0) + 1,
      status: "ACTIVE",
      assignedAt: this.now().toISOString(),
      assignedBy: actorAccountId
    };
    await this.store.replaceAuthority(authority, reason);
    return authority;
  }
}
