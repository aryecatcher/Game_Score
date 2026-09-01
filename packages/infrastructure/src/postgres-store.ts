import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { ScoreEventSchema, type GameSnapshot, type Id, type ScoreEvent, type ScoreEventInput } from "@gamechanger/contracts";
import type { PlatformStore } from "@gamechanger/application";
import { DomainError, projectScore, type Account, type AthleteProfile, type AuditLog, type Game, type OutboxEvent, type PolicyConfig, type RoleGrant, type ScorerAuthority, type Season, type StreamSession, type Team } from "@gamechanger/domain";

function one<T extends QueryResultRow>(rows: T[]): T | undefined { return rows[0]; }
function asId(value: string): Id { return value as Id; }

function mapEvent(row: QueryResultRow): ScoreEvent {
  return ScoreEventSchema.parse({
    id: row.id,
    gameId: row.game_id,
    clientEventId: row.client_event_id,
    actorAccountId: row.actor_account_id,
    deviceId: row.device_id,
    authorityEpoch: Number(row.authority_epoch),
    sequence: Number(row.sequence),
    occurredAt: new Date(row.client_occurred_at).toISOString(),
    recordedAt: new Date(row.recorded_at).toISOString(),
    payload: row.payload,
    schemaVersion: row.schema_version,
    rulesVersion: row.rules_version,
    statSetVersion: row.stat_set_version,
    correlationId: row.correlation_id
  });
}

export class PostgresPlatformStore implements PlatformStore {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10, application_name: "gamechanger-api", statement_timeout: 5000 });
  }

  async close(): Promise<void> { await this.pool.end(); }

  async getAccount(id: Id): Promise<Account | undefined> {
    const row = one((await this.pool.query("SELECT id, display_name, status FROM accounts WHERE id = $1", [id])).rows);
    return row ? { id: asId(row.id), displayName: row.display_name, status: row.status } : undefined;
  }

  async getAccountByExternalSubject(subject: string): Promise<Account | undefined> {
    const row = one((await this.pool.query("SELECT id, display_name, status FROM accounts WHERE external_subject=$1", [subject])).rows);
    return row ? { id: asId(row.id), displayName: row.display_name, status: row.status } : undefined;
  }

  async getTeam(id: Id): Promise<Team | undefined> {
    const row = one((await this.pool.query("SELECT t.id, t.name, t.status, s.id AS season_id FROM teams t LEFT JOIN LATERAL (SELECT id FROM seasons WHERE team_id=t.id ORDER BY starts_on DESC NULLS LAST, id LIMIT 1) s ON true WHERE t.id=$1", [id])).rows);
    return row?.season_id ? { id: asId(row.id), name: row.name, seasonId: asId(row.season_id), status: row.status } : undefined;
  }

  async getSeason(id: Id): Promise<Season | undefined> {
    const row = one((await this.pool.query("SELECT id, team_id, name, status FROM seasons WHERE id=$1", [id])).rows);
    return row ? { id: asId(row.id), teamId: asId(row.team_id), name: row.name, status: row.status } : undefined;
  }

  async getGame(id: Id): Promise<Game | undefined> {
    const row = one((await this.pool.query("SELECT id, team_id, home_team_name, away_team_name, scheduled_at, status FROM games WHERE id=$1", [id])).rows);
    return row ? { id: asId(row.id), teamId: asId(row.team_id), homeTeamName: row.home_team_name, awayTeamName: row.away_team_name, scheduledAt: new Date(row.scheduled_at).toISOString(), status: row.status } : undefined;
  }

  async listAthletes(teamId: Id): Promise<AthleteProfile[]> {
    const { rows } = await this.pool.query("SELECT id, team_id, display_name, jersey_number FROM athlete_profiles WHERE team_id=$1 ORDER BY display_name", [teamId]);
    return rows.map((row) => ({ id: asId(row.id), teamId: asId(row.team_id), displayName: row.display_name, ...(row.jersey_number ? { jerseyNumber: row.jersey_number } : {}), loginEnabled: false }));
  }

  async listGrants(accountId: Id): Promise<RoleGrant[]> {
    const { rows } = await this.pool.query("SELECT id, account_id, role, scope_type, scope_id, status, expires_at FROM role_grants WHERE account_id=$1", [accountId]);
    return rows.map((row) => ({ id: asId(row.id), accountId: asId(row.account_id), role: row.role, scopeType: row.scope_type, scopeId: row.scope_id ? asId(row.scope_id) : null, status: row.status, ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}) }));
  }

  async getAuthority(gameId: Id): Promise<ScorerAuthority | undefined> {
    const row = one((await this.pool.query("SELECT game_id, account_id, authority_epoch, status, assigned_at, assigned_by FROM scorer_authorities WHERE game_id=$1 AND status='ACTIVE'", [gameId])).rows);
    return row ? { gameId: asId(row.game_id), accountId: asId(row.account_id), authorityEpoch: Number(row.authority_epoch), status: row.status, assignedAt: new Date(row.assigned_at).toISOString(), assignedBy: asId(row.assigned_by) } : undefined;
  }

  async replaceAuthority(authority: ScorerAuthority, reason: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM games WHERE id=$1 FOR UPDATE", [authority.gameId]);
      await client.query("UPDATE scorer_authorities SET status='REVOKED', revoked_at=now() WHERE game_id=$1 AND status='ACTIVE'", [authority.gameId]);
      await client.query("INSERT INTO scorer_authorities (id,game_id,account_id,authority_epoch,status,assigned_at,assigned_by,handoff_reason) VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7)", [randomUUID(), authority.gameId, authority.accountId, authority.authorityEpoch, authority.assignedAt, authority.assignedBy, reason]);
      const auditId = randomUUID();
      await client.query("INSERT INTO audit_logs (id,actor_account_id,action,scope_type,scope_id,reason,metadata,recorded_at) VALUES ($1,$2,'SCORER_ASSIGN','GAME',$3,$4,$5,$6)", [auditId, authority.assignedBy, authority.gameId, reason, { accountId: authority.accountId, authorityEpoch: authority.authorityEpoch }, authority.assignedAt]);
      await client.query("INSERT INTO outbox_events (id,aggregate_type,aggregate_id,event_type,payload,recorded_at,attempts) VALUES ($1,'GAME',$2,'scorer.authority.changed',$3,$4,0)", [randomUUID(), authority.gameId, { accountId: authority.accountId, authorityEpoch: authority.authorityEpoch }, authority.assignedAt]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listEvents(gameId: Id, afterSequence = 0): Promise<ScoreEvent[]> {
    const { rows } = await this.pool.query("SELECT * FROM score_events WHERE game_id=$1 AND sequence>$2 ORDER BY sequence", [gameId, afterSequence]);
    return rows.map(mapEvent);
  }

  async getEventByClientId(gameId: Id, clientEventId: Id): Promise<ScoreEvent | undefined> {
    const row = one((await this.pool.query("SELECT * FROM score_events WHERE game_id=$1 AND client_event_id=$2", [gameId, clientEventId])).rows);
    return row ? mapEvent(row) : undefined;
  }

  async appendScoreTransaction(events: ScoreEvent[], audits: AuditLog[], outbox: OutboxEvent[]): Promise<GameSnapshot> {
    const gameId = events[0]?.gameId;
    if (!gameId) throw new DomainError("VALIDATION_ERROR", "Score transaction requires at least one event.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const gameRow = one((await client.query("SELECT revision, status FROM games WHERE id=$1 FOR UPDATE", [gameId])).rows);
      if (!gameRow) throw new DomainError("NOT_FOUND", "Game was not found.", 404);
      if (gameRow.status === "FINAL") throw new DomainError("GAME_FINAL", "Final games reject ordinary score events.", 409);
      const authority = one((await client.query("SELECT account_id, authority_epoch FROM scorer_authorities WHERE game_id=$1 AND status='ACTIVE'", [gameId])).rows);
      const first = events[0]!;
      if (!authority || authority.account_id !== first.actorAccountId || Number(authority.authority_epoch) !== first.authorityEpoch) {
        throw new DomainError("STALE_AUTHORITY", "Scorer authority changed before commit.", 409);
      }
      const revision = Number(gameRow.revision);
      if (events.some((event, index) => event.sequence !== revision + index + 1)) throw new DomainError("REVISION_CONFLICT", "Canonical sequence changed before commit.", 409, { currentRevision: revision });

      for (const event of events) {
        await client.query("INSERT INTO score_events (id,game_id,client_event_id,actor_account_id,device_id,authority_epoch,sequence,event_type,schema_version,rules_version,stat_set_version,correlation_id,payload,client_occurred_at,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)", [event.id, event.gameId, event.clientEventId, event.actorAccountId, event.deviceId, event.authorityEpoch, event.sequence, event.payload.type, event.schemaVersion, event.rulesVersion, event.statSetVersion, event.correlationId, event.payload, event.occurredAt, event.recordedAt]);
      }
      const allEvents = (await client.query("SELECT * FROM score_events WHERE game_id=$1 ORDER BY sequence", [gameId])).rows.map(mapEvent);
      const snapshot = projectScore(gameId, allEvents);
      await client.query("UPDATE games SET revision=$2, status=$3, finalized_at=CASE WHEN $3='FINAL' THEN now() ELSE finalized_at END, updated_at=now() WHERE id=$1", [gameId, snapshot.revision, snapshot.status]);
      for (const audit of audits) await this.insertAudit(client, audit);
      for (const item of outbox) await client.query("INSERT INTO outbox_events (id,aggregate_type,aggregate_id,event_type,payload,recorded_at,processed_at,attempts) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [item.id, item.aggregateType, item.aggregateId, item.eventType, item.payload, item.recordedAt, item.processedAt, item.attempts]);
      await client.query("COMMIT");
      return snapshot;
    } catch (error) {
      await client.query("ROLLBACK");
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new DomainError("REVISION_CONFLICT", "Concurrent score append conflicted.", 409);
      throw error;
    } finally { client.release(); }
  }

  private async insertAudit(client: PoolClient, audit: AuditLog): Promise<void> {
    await client.query("INSERT INTO audit_logs (id,actor_account_id,action,scope_type,scope_id,reason,metadata,recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [audit.id, audit.actorAccountId, audit.action, audit.scopeType, audit.scopeId, audit.reason ?? null, audit.metadata, audit.recordedAt]);
  }

  async quarantine(inputs: ScoreEventInput[], gameId: Id, accountId: Id, authorityEpoch: number): Promise<void> {
    for (const input of inputs) await this.pool.query("INSERT INTO quarantined_score_events (id,game_id,account_id,client_event_id,received_authority_epoch,reason,envelope) VALUES ($1,$2,$3,$4,$5,'STALE_AUTHORITY',$6) ON CONFLICT (game_id,client_event_id) DO NOTHING", [randomUUID(), gameId, accountId, input.clientEventId, authorityEpoch, input]);
  }

  async saveStream(stream: StreamSession): Promise<void> {
    await this.pool.query("INSERT INTO stream_sessions (id,game_id,started_by,provider,provider_stream_id,status,ingest_metadata,playback_metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [stream.id, stream.gameId, stream.startedBy, stream.provider, stream.providerStreamId, stream.status, { ingestUrl: stream.ingestUrl }, { playbackUrl: stream.playbackUrl }, stream.createdAt]);
  }

  async findStreamByGame(gameId: Id): Promise<StreamSession | undefined> {
    const row = one((await this.pool.query("SELECT * FROM stream_sessions WHERE game_id=$1 AND status<>'ENDED' ORDER BY created_at DESC LIMIT 1", [gameId])).rows);
    return row ? { id: asId(row.id), gameId: asId(row.game_id), startedBy: asId(row.started_by), provider: row.provider, providerStreamId: row.provider_stream_id, status: row.status, ingestUrl: row.ingest_metadata.ingestUrl, playbackUrl: row.playback_metadata.playbackUrl, createdAt: new Date(row.created_at).toISOString() } : undefined;
  }

  async listOutbox(limit: number): Promise<OutboxEvent[]> {
    const { rows } = await this.pool.query("SELECT * FROM outbox_events WHERE processed_at IS NULL ORDER BY recorded_at LIMIT $1", [limit]);
    return rows.map((row) => ({ id: asId(row.id), aggregateType: row.aggregate_type, aggregateId: asId(row.aggregate_id), eventType: row.event_type, payload: row.payload, recordedAt: new Date(row.recorded_at).toISOString(), processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null, attempts: row.attempts }));
  }

  async acknowledgeOutbox(id: Id): Promise<boolean> {
    const result = await this.pool.query("UPDATE outbox_events SET processed_at=now(), attempts=attempts+1 WHERE id=$1 AND processed_at IS NULL", [id]);
    return result.rowCount === 1;
  }

  async policy(): Promise<PolicyConfig> {
    const row = one((await this.pool.query("SELECT * FROM policy_configs WHERE effective_at<=now() ORDER BY effective_at DESC LIMIT 1")).rows);
    if (!row) return { regionCode: "UNSET", policyVersion: "missing", accountMinAge: null, guardianConsentMode: "deny", publicSharingEnabled: false, athleteLoginEnabled: false, retentionDays: null, deletionSlaDays: null };
    return { regionCode: row.region_code, policyVersion: row.policy_version, accountMinAge: row.account_min_age, guardianConsentMode: row.guardian_consent_mode, publicSharingEnabled: false, athleteLoginEnabled: false, retentionDays: row.retention_days, deletionSlaDays: row.deletion_sla_days };
  }
}
