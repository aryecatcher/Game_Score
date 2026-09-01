import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ScoreEventSchema, type GameSnapshot, type Id, type ScoreEvent } from "@gamechanger/contracts";
import { projectScore, type OutboxEvent } from "@gamechanger/domain";

function mapScoreRow(row: Record<string, unknown>): ScoreEvent {
  return ScoreEventSchema.parse({
    id: row.id,
    gameId: row.game_id,
    clientEventId: row.client_event_id,
    actorAccountId: row.actor_account_id,
    deviceId: row.device_id,
    authorityEpoch: Number(row.authority_epoch),
    sequence: Number(row.sequence),
    occurredAt: new Date(row.client_occurred_at as string).toISOString(),
    recordedAt: new Date(row.recorded_at as string).toISOString(),
    payload: row.payload,
    schemaVersion: row.schema_version,
    rulesVersion: row.rules_version,
    statSetVersion: row.stat_set_version,
    correlationId: row.correlation_id
  });
}

export class PostgresOutboxWorkerStore {
  readonly pool: Pool;
  readonly workerId = randomUUID();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, application_name: "gamechanger-worker", statement_timeout: 15_000 });
  }

  async claim(limit: number): Promise<OutboxEvent[]> {
    const { rows } = await this.pool.query(
      `WITH candidates AS (
         SELECT id FROM outbox_events
         WHERE processed_at IS NULL AND (locked_at IS NULL OR locked_at < now() - interval '2 minutes')
         ORDER BY recorded_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE outbox_events o SET locked_at=now(), locked_by=$2, attempts=o.attempts+1
       FROM candidates c WHERE o.id=c.id
       RETURNING o.*`,
      [limit, this.workerId]
    );
    return rows.map((row) => ({ id: row.id as Id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id as Id, eventType: row.event_type, payload: row.payload, recordedAt: new Date(row.recorded_at).toISOString(), processedAt: null, attempts: row.attempts }));
  }

  async acknowledge(id: Id): Promise<void> {
    await this.pool.query("UPDATE outbox_events SET processed_at=now(), locked_at=NULL, locked_by=NULL, last_error=NULL WHERE id=$1 AND locked_by=$2", [id, this.workerId]);
  }

  async fail(id: Id, error: string): Promise<void> {
    await this.pool.query("UPDATE outbox_events SET locked_at=NULL, locked_by=NULL, last_error=$3 WHERE id=$1 AND locked_by=$2", [id, this.workerId, error.slice(0, 1000)]);
  }

  async rebuildGameProjection(gameId: Id): Promise<GameSnapshot> {
    const { rows } = await this.pool.query("SELECT * FROM score_events WHERE game_id=$1 ORDER BY sequence", [gameId]);
    const snapshot = projectScore(gameId, rows.map(mapScoreRow));
    await this.pool.query(
      "INSERT INTO game_snapshots (game_id,revision,snapshot,updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (game_id) DO UPDATE SET revision=EXCLUDED.revision,snapshot=EXCLUDED.snapshot,updated_at=now() WHERE game_snapshots.revision <= EXCLUDED.revision",
      [gameId, snapshot.revision, snapshot]
    );
    return snapshot;
  }

  async close(): Promise<void> { await this.pool.end(); }
}
