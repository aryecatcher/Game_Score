import type { Id, Role, ScoreEvent } from "@gamechanger/contracts";

export interface Account {
  id: Id;
  displayName: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
}

export interface Team {
  id: Id;
  name: string;
  seasonId: Id;
  status: "ACTIVE" | "ARCHIVED";
}

export interface Season {
  id: Id;
  teamId: Id;
  name: string;
  status: "OPEN" | "CLOSED";
}

export interface AthleteProfile {
  id: Id;
  teamId: Id;
  displayName: string;
  jerseyNumber?: string;
  loginEnabled: false;
}

export interface Game {
  id: Id;
  teamId: Id;
  homeTeamName: string;
  awayTeamName: string;
  scheduledAt: string;
  status: "SCHEDULED" | "LIVE" | "FINAL" | "CANCELLED";
}

export interface RoleGrant {
  id: Id;
  accountId: Id;
  role: Role;
  scopeType: "PLATFORM" | "TEAM" | "GAME";
  scopeId: Id | null;
  status: "ACTIVE" | "REVOKED";
  expiresAt?: string;
}

export interface ScorerAuthority {
  gameId: Id;
  accountId: Id;
  authorityEpoch: number;
  status: "ACTIVE" | "REVOKED";
  assignedAt: string;
  assignedBy: Id;
}

export interface PolicyConfig {
  regionCode: string;
  policyVersion: string;
  accountMinAge: number | null;
  guardianConsentMode: string;
  publicSharingEnabled: false;
  athleteLoginEnabled: false;
  retentionDays: number | null;
  deletionSlaDays: number | null;
}

export interface ConsentRecord {
  id: Id;
  teamId: Id;
  subjectAthleteId: Id;
  guardianAccountId: Id;
  status: "PENDING" | "GRANTED" | "WITHDRAWN";
  policyVersion: string;
  occurredAt: string;
}

export interface StreamSession {
  id: Id;
  gameId: Id;
  startedBy: Id;
  provider: "mock" | "aws-ivs" | "mux";
  providerStreamId: string;
  status: "CREATED" | "LIVE" | "ENDED" | "BLOCKED";
  ingestUrl: string;
  playbackUrl: string;
  createdAt: string;
}

export interface AuditLog {
  id: Id;
  actorAccountId: Id;
  action: string;
  scopeType: string;
  scopeId: Id;
  reason?: string;
  metadata: Record<string, unknown>;
  recordedAt: string;
}

export interface OutboxEvent {
  id: Id;
  aggregateType: string;
  aggregateId: Id;
  eventType: string;
  payload: Record<string, unknown>;
  recordedAt: string;
  processedAt: string | null;
  attempts: number;
}

export interface QuarantinedScoreEvent {
  id: Id;
  gameId: Id;
  accountId: Id;
  authorityEpoch: number;
  event: ScoreEvent | Record<string, unknown>;
  reason: "STALE_AUTHORITY" | "INVALID_EVENT";
  recordedAt: string;
}
