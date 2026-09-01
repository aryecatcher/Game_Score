import { randomUUID } from "node:crypto";
import type { GameSnapshot, Id, ScoreEvent, ScoreEventInput } from "@gamechanger/contracts";
import type { Account, AthleteProfile, AuditLog, Game, OutboxEvent, PolicyConfig, QuarantinedScoreEvent, RoleGrant, ScorerAuthority, Season, StreamSession, Team } from "@gamechanger/domain";
import { DomainError, projectScore } from "@gamechanger/domain";
import { FIXTURE_IDS } from "./fixtures.js";

export interface PlatformStore {
  close?(): Promise<void>;
  getAccount(id: Id): Promise<Account | undefined>;
  getAccountByExternalSubject(subject: string): Promise<Account | undefined>;
  getTeam(id: Id): Promise<Team | undefined>;
  getSeason(id: Id): Promise<Season | undefined>;
  getGame(id: Id): Promise<Game | undefined>;
  listAthletes(teamId: Id): Promise<AthleteProfile[]>;
  listGrants(accountId: Id): Promise<RoleGrant[]>;
  getAuthority(gameId: Id): Promise<ScorerAuthority | undefined>;
  replaceAuthority(authority: ScorerAuthority, reason: string): Promise<void>;
  listEvents(gameId: Id, afterSequence?: number): Promise<ScoreEvent[]>;
  getEventByClientId(gameId: Id, clientEventId: Id): Promise<ScoreEvent | undefined>;
  appendScoreTransaction(events: ScoreEvent[], audit: AuditLog[], outbox: OutboxEvent[]): Promise<GameSnapshot>;
  quarantine(inputs: ScoreEventInput[], gameId: Id, accountId: Id, authorityEpoch: number): Promise<void>;
  saveStream(stream: StreamSession): Promise<void>;
  findStreamByGame(gameId: Id): Promise<StreamSession | undefined>;
  listOutbox(limit: number): Promise<OutboxEvent[]>;
  acknowledgeOutbox(id: Id): Promise<boolean>;
  policy(): Promise<PolicyConfig>;
}

export class InMemoryPlatformStore implements PlatformStore {
  private readonly accounts = new Map<Id, Account>();
  private readonly teams = new Map<Id, Team>();
  private readonly seasons = new Map<Id, Season>();
  private readonly games = new Map<Id, Game>();
  private readonly athletes: AthleteProfile[] = [];
  private readonly grants: RoleGrant[] = [];
  private readonly authorities = new Map<Id, ScorerAuthority>();
  private readonly events = new Map<Id, ScoreEvent[]>();
  private readonly streams = new Map<Id, StreamSession>();
  readonly audits: AuditLog[] = [];
  readonly outbox: OutboxEvent[] = [];
  readonly quarantined: QuarantinedScoreEvent[] = [];
  private readonly policyConfig: PolicyConfig;

  constructor(policy?: Partial<PolicyConfig>) {
    this.policyConfig = {
      regionCode: "UNSET",
      policyVersion: "draft-local",
      accountMinAge: null,
      guardianConsentMode: "pilot-review-required",
      publicSharingEnabled: false,
      athleteLoginEnabled: false,
      retentionDays: null,
      deletionSlaDays: null,
      ...policy
    };
    this.seed();
  }

  private seed(): void {
    const people: Array<[Id, string]> = [
      [FIXTURE_IDS.staff, "Synthetic Team Staff"],
      [FIXTURE_IDS.scorer, "Synthetic Official Scorer"],
      [FIXTURE_IDS.videographer, "Synthetic Videographer"],
      [FIXTURE_IDS.guardian, "Synthetic Guardian"],
      [FIXTURE_IDS.fan, "Synthetic Approved Fan"],
      [FIXTURE_IDS.outsider, "Synthetic Outsider"],
      [FIXTURE_IDS.admin, "Synthetic Platform Admin"]
    ];
    people.forEach(([id, displayName]) => this.accounts.set(id, { id, displayName, status: "ACTIVE" }));
    this.teams.set(FIXTURE_IDS.team, { id: FIXTURE_IDS.team, name: "Synthetic Pilot Bears", seasonId: FIXTURE_IDS.season, status: "ACTIVE" });
    this.seasons.set(FIXTURE_IDS.season, { id: FIXTURE_IDS.season, teamId: FIXTURE_IDS.team, name: "Synthetic 2026 Pilot", status: "OPEN" });
    this.games.set(FIXTURE_IDS.game, {
      id: FIXTURE_IDS.game,
      teamId: FIXTURE_IDS.team,
      homeTeamName: "Synthetic Pilot Bears",
      awayTeamName: "Synthetic Visitors",
      scheduledAt: "2026-09-01T18:00:00.000Z",
      status: "SCHEDULED"
    });
    this.athletes.push(
      { id: FIXTURE_IDS.homeBatter, teamId: FIXTURE_IDS.team, displayName: "Synthetic Player 01", jerseyNumber: "7", loginEnabled: false },
      { id: FIXTURE_IDS.awayBatter, teamId: FIXTURE_IDS.team, displayName: "Synthetic Player 02", jerseyNumber: "12", loginEnabled: false }
    );
    const roleSeed: Array<[Id, RoleGrant["role"], RoleGrant["scopeType"], Id | null]> = [
      [FIXTURE_IDS.staff, "TEAM_STAFF", "TEAM", FIXTURE_IDS.team],
      [FIXTURE_IDS.scorer, "OFFICIAL_SCOREKEEPER", "GAME", FIXTURE_IDS.game],
      [FIXTURE_IDS.videographer, "VIDEOGRAPHER", "GAME", FIXTURE_IDS.game],
      [FIXTURE_IDS.guardian, "GUARDIAN_FAMILY", "TEAM", FIXTURE_IDS.team],
      [FIXTURE_IDS.fan, "APPROVED_FAN", "TEAM", FIXTURE_IDS.team],
      [FIXTURE_IDS.admin, "PLATFORM_ADMIN", "PLATFORM", null]
    ];
    roleSeed.forEach(([accountId, role, scopeType, scopeId], index) => this.grants.push({
      id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` as Id,
      accountId,
      role,
      scopeType,
      scopeId,
      status: "ACTIVE"
    }));
    this.authorities.set(FIXTURE_IDS.game, {
      gameId: FIXTURE_IDS.game,
      accountId: FIXTURE_IDS.scorer,
      authorityEpoch: 1,
      status: "ACTIVE",
      assignedAt: new Date().toISOString(),
      assignedBy: FIXTURE_IDS.staff
    });
    this.events.set(FIXTURE_IDS.game, []);
  }

  async getAccount(id: Id): Promise<Account | undefined> { return this.accounts.get(id); }
  async getAccountByExternalSubject(_subject: string): Promise<Account | undefined> { return undefined; }
  async getTeam(id: Id): Promise<Team | undefined> { return this.teams.get(id); }
  async getSeason(id: Id): Promise<Season | undefined> { return this.seasons.get(id); }
  async getGame(id: Id): Promise<Game | undefined> { return this.games.get(id); }
  async listAthletes(teamId: Id): Promise<AthleteProfile[]> { return this.athletes.filter((item) => item.teamId === teamId); }
  async listGrants(accountId: Id): Promise<RoleGrant[]> { return this.grants.filter((item) => item.accountId === accountId); }
  async getAuthority(gameId: Id): Promise<ScorerAuthority | undefined> { return this.authorities.get(gameId); }
  async replaceAuthority(authority: ScorerAuthority, reason: string): Promise<void> {
    this.authorities.set(authority.gameId, authority);
    this.audits.push({
      id: randomUUID() as Id,
      actorAccountId: authority.assignedBy,
      action: "SCORER_ASSIGN",
      scopeType: "GAME",
      scopeId: authority.gameId,
      reason,
      metadata: { accountId: authority.accountId, authorityEpoch: authority.authorityEpoch },
      recordedAt: authority.assignedAt
    });
    this.outbox.push({
      id: randomUUID() as Id,
      aggregateType: "GAME",
      aggregateId: authority.gameId,
      eventType: "scorer.authority.changed",
      payload: { accountId: authority.accountId, authorityEpoch: authority.authorityEpoch },
      recordedAt: authority.assignedAt,
      processedAt: null,
      attempts: 0
    });
  }
  async listEvents(gameId: Id, afterSequence = 0): Promise<ScoreEvent[]> { return [...(this.events.get(gameId) ?? [])].filter((event) => event.sequence > afterSequence); }
  async getEventByClientId(gameId: Id, clientEventId: Id): Promise<ScoreEvent | undefined> { return this.events.get(gameId)?.find((event) => event.clientEventId === clientEventId); }

  async appendScoreTransaction(events: ScoreEvent[], audit: AuditLog[], outbox: OutboxEvent[]): Promise<GameSnapshot> {
    if (events.length === 0) {
      const gameId = audit[0]?.scopeId ?? FIXTURE_IDS.game;
      return projectScore(gameId, await this.listEvents(gameId));
    }
    const gameId = events[0]!.gameId;
    const existing = this.events.get(gameId) ?? [];
    const expectedSequence = (existing.at(-1)?.sequence ?? 0) + 1;
    if (events[0]!.sequence !== expectedSequence) {
      throw new DomainError("REVISION_CONFLICT", "Concurrent score append changed the canonical sequence.", 409, { currentRevision: expectedSequence - 1 });
    }
    const authority = this.authorities.get(gameId);
    if (!authority || authority.accountId !== events[0]!.actorAccountId || authority.authorityEpoch !== events[0]!.authorityEpoch) {
      throw new DomainError("STALE_AUTHORITY", "Scorer authority changed before commit.", 409);
    }
    this.events.set(gameId, [...existing, ...events]);
    this.audits.push(...audit);
    this.outbox.push(...outbox);
    const snapshot = projectScore(gameId, this.events.get(gameId) ?? []);
    const game = this.games.get(gameId);
    if (game && snapshot.status !== game.status) this.games.set(gameId, { ...game, status: snapshot.status });
    return snapshot;
  }

  async quarantine(inputs: ScoreEventInput[], gameId: Id, accountId: Id, authorityEpoch: number): Promise<void> {
    const recordedAt = new Date().toISOString();
    inputs.forEach((event) => this.quarantined.push({
      id: randomUUID() as Id,
      gameId,
      accountId,
      authorityEpoch,
      event,
      reason: "STALE_AUTHORITY",
      recordedAt
    }));
  }

  async saveStream(stream: StreamSession): Promise<void> { this.streams.set(stream.id, stream); }
  async findStreamByGame(gameId: Id): Promise<StreamSession | undefined> { return [...this.streams.values()].find((stream) => stream.gameId === gameId && stream.status !== "ENDED"); }
  async listOutbox(limit: number): Promise<OutboxEvent[]> { return this.outbox.filter((item) => item.processedAt === null).slice(0, limit); }
  async acknowledgeOutbox(id: Id): Promise<boolean> {
    const item = this.outbox.find((candidate) => candidate.id === id);
    if (!item) return false;
    item.processedAt = new Date().toISOString();
    item.attempts += 1;
    return true;
  }
  async policy(): Promise<PolicyConfig> { return { ...this.policyConfig }; }
}
