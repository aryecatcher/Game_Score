BEGIN;

CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  external_subject text UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seasons (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  starts_on date,
  ends_on date,
  UNIQUE (team_id, name)
);

CREATE TABLE athlete_profiles (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  display_name text NOT NULL,
  jersey_number text,
  login_enabled boolean NOT NULL DEFAULT false CHECK (login_enabled = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  team_id uuid NOT NULL REFERENCES teams(id),
  status text NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'REVOKED', 'EXPIRED')),
  invited_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (account_id, team_id)
);

CREATE TABLE games (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  season_id uuid NOT NULL REFERENCES seasons(id),
  home_team_name text NOT NULL,
  away_team_name text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL CHECK (status IN ('SCHEDULED', 'LIVE', 'FINAL', 'CANCELLED')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_grants (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  role text NOT NULL CHECK (role IN ('TEAM_STAFF', 'OFFICIAL_SCOREKEEPER', 'VIDEOGRAPHER', 'GUARDIAN_FAMILY', 'APPROVED_FAN', 'PLATFORM_ADMIN')),
  scope_type text NOT NULL CHECK (scope_type IN ('PLATFORM', 'TEAM', 'GAME')),
  scope_id uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK ((scope_type = 'PLATFORM' AND scope_id IS NULL) OR (scope_type <> 'PLATFORM' AND scope_id IS NOT NULL))
);
CREATE INDEX role_grants_lookup_idx ON role_grants (account_id, status, scope_type, scope_id);

CREATE TABLE scorer_authorities (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  assigned_at timestamptz NOT NULL,
  assigned_by uuid NOT NULL REFERENCES accounts(id),
  revoked_at timestamptz,
  handoff_reason text NOT NULL,
  UNIQUE (game_id, authority_epoch)
);
CREATE UNIQUE INDEX scorer_authorities_one_active_idx ON scorer_authorities (game_id) WHERE status = 'ACTIVE';

CREATE TABLE score_events (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id),
  client_event_id uuid NOT NULL,
  actor_account_id uuid NOT NULL REFERENCES accounts(id),
  device_id uuid NOT NULL,
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  schema_version text NOT NULL,
  rules_version text NOT NULL,
  stat_set_version text NOT NULL,
  correlation_id uuid NOT NULL,
  payload jsonb NOT NULL,
  client_occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, client_event_id),
  UNIQUE (game_id, sequence)
);
CREATE INDEX score_events_replay_idx ON score_events (game_id, sequence);

CREATE TABLE quarantined_score_events (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  client_event_id uuid NOT NULL,
  received_authority_epoch bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('STALE_AUTHORITY', 'INVALID_EVENT')),
  envelope jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES accounts(id),
  UNIQUE (game_id, client_event_id)
);

CREATE TABLE game_snapshots (
  game_id uuid PRIMARY KEY REFERENCES games(id),
  revision bigint NOT NULL CHECK (revision >= 0),
  snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stat_projections (
  game_id uuid NOT NULL REFERENCES games(id),
  projection_name text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  projection jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, projection_name)
);

CREATE TABLE policy_configs (
  id uuid PRIMARY KEY,
  region_code text NOT NULL,
  policy_version text NOT NULL,
  account_min_age integer,
  guardian_consent_mode text NOT NULL,
  public_sharing_enabled boolean NOT NULL DEFAULT false CHECK (public_sharing_enabled = false),
  athlete_login_enabled boolean NOT NULL DEFAULT false CHECK (athlete_login_enabled = false),
  retention_days integer,
  deletion_sla_days integer,
  effective_at timestamptz NOT NULL,
  UNIQUE (region_code, policy_version)
);

CREATE TABLE consent_records (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  subject_athlete_id uuid NOT NULL REFERENCES athlete_profiles(id),
  guardian_account_id uuid NOT NULL REFERENCES accounts(id),
  status text NOT NULL CHECK (status IN ('PENDING', 'GRANTED', 'WITHDRAWN')),
  policy_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX consent_current_idx ON consent_records (subject_athlete_id, occurred_at DESC);

CREATE TABLE stream_sessions (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id),
  started_by uuid NOT NULL REFERENCES accounts(id),
  provider text NOT NULL CHECK (provider IN ('mock', 'aws-ivs', 'mux')),
  provider_stream_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATED', 'LIVE', 'ENDED', 'BLOCKED')),
  ingest_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  playback_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (provider, provider_stream_id)
);

CREATE TABLE recordings (
  id uuid PRIMARY KEY,
  stream_session_id uuid NOT NULL REFERENCES stream_sessions(id),
  object_key text,
  provider_asset_id text,
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'BLOCKED', 'DELETED')),
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quota_policies (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  unit text NOT NULL CHECK (unit IN ('VIDEO_MINUTE')),
  grant_units integer NOT NULL CHECK (grant_units >= 0),
  effective_at timestamptz NOT NULL,
  expires_at timestamptz
);

CREATE TABLE quota_ledger (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('GRANT', 'RESERVE', 'COMMIT', 'RELEASE')),
  units integer NOT NULL CHECK (units > 0),
  reservation_key uuid,
  reference_type text,
  reference_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quota_reservation_kind_idx ON quota_ledger (reservation_key, kind) WHERE reservation_key IS NOT NULL;
CREATE INDEX quota_account_ledger_idx ON quota_ledger (account_id, recorded_at);

CREATE TABLE offers (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  price_minor integer,
  currency char(3),
  purchasable boolean NOT NULL DEFAULT false CHECK (purchasable = false),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  actor_account_id uuid REFERENCES accounts(id),
  action text NOT NULL,
  scope_type text NOT NULL,
  scope_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_scope_idx ON audit_logs (scope_type, scope_id, recorded_at DESC);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  locked_at timestamptz,
  locked_by uuid,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX outbox_pending_idx ON outbox_events (recorded_at) WHERE processed_at IS NULL;

COMMIT;
