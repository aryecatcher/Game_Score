import { z } from "zod";

export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

export const RoleSchema = z.enum([
  "TEAM_STAFF",
  "OFFICIAL_SCOREKEEPER",
  "VIDEOGRAPHER",
  "GUARDIAN_FAMILY",
  "APPROVED_FAN",
  "PLATFORM_ADMIN"
]);
export type Role = z.infer<typeof RoleSchema>;

export const ActionSchema = z.enum([
  "TEAM_UPDATE",
  "ROSTER_MANAGE",
  "SCORER_ASSIGN",
  "SCORE_EVENT_APPEND",
  "SCORE_CORRECT",
  "STREAM_START",
  "PLAYBACK_AUTHORIZE",
  "CONTENT_TAKEDOWN",
  "QUOTA_GRANT",
  "AUDIT_READ"
]);
export type Action = z.infer<typeof ActionSchema>;

export const ReasonCodeSchema = z.enum([
  "ROLE_MISSING",
  "SCOPE_MISMATCH",
  "FIELD_FORBIDDEN",
  "SEASON_CLOSED",
  "STALE_AUTHORITY",
  "REVISION_CONFLICT",
  "GAME_FINAL",
  "TARGET_EVENT_MISSING",
  "CROSS_GAME_REFERENCE",
  "STREAM_ROLE_MISSING",
  "CONTENT_BLOCKED",
  "MEMBERSHIP_REVOKED",
  "CONSENT_REQUIRED",
  "QUOTA_EXHAUSTED",
  "APPROVAL_REQUIRED",
  "PILOT_SCOPE_ONLY",
  "DUPLICATE_REQUEST",
  "ADMIN_SCOPE_MISSING",
  "REASON_REQUIRED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNAUTHENTICATED",
  "INTERNAL_ERROR",
  "RULES_VERSION_MISMATCH",
  "STAT_SET_VERSION_MISMATCH"
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const SideSchema = z.enum(["HOME", "AWAY"]);
export type Side = z.infer<typeof SideSchema>;

export const PlateAppearanceResultSchema = z.enum([
  "SINGLE",
  "DOUBLE",
  "TRIPLE",
  "HOME_RUN",
  "WALK",
  "STRIKEOUT",
  "OUT",
  "HIT_BY_PITCH",
  "ERROR",
  "FIELDER_CHOICE",
  "SACRIFICE"
]);

const GameStartedPayloadSchema = z.object({
  type: z.literal("GAME_STARTED")
});

const PlateAppearancePayloadSchema = z.object({
  type: z.literal("PLATE_APPEARANCE_RECORDED"),
  offense: SideSchema,
  batterAthleteId: IdSchema,
  result: PlateAppearanceResultSchema,
  runs: z.number().int().min(0).max(4),
  outs: z.number().int().min(0).max(3),
  rbi: z.number().int().min(0).max(4)
});

const HalfInningAdvancedPayloadSchema = z.object({
  type: z.literal("HALF_INNING_ADVANCED")
});

const GameFinalizedPayloadSchema = z.object({
  type: z.literal("GAME_FINALIZED")
});

export const ScoreMutationSchema = z.discriminatedUnion("type", [
  GameStartedPayloadSchema,
  PlateAppearancePayloadSchema,
  HalfInningAdvancedPayloadSchema,
  GameFinalizedPayloadSchema
]);
export type ScoreMutation = z.infer<typeof ScoreMutationSchema>;

const CorrectionPayloadSchema = z.object({
  type: z.literal("CORRECTION_APPLIED"),
  targetClientEventId: IdSchema,
  replacement: ScoreMutationSchema.nullable(),
  reason: z.string().trim().min(1).max(500)
});

export const ScoreEventPayloadSchema = z.discriminatedUnion("type", [
  GameStartedPayloadSchema,
  PlateAppearancePayloadSchema,
  HalfInningAdvancedPayloadSchema,
  GameFinalizedPayloadSchema,
  CorrectionPayloadSchema
]);
export type ScoreEventPayload = z.infer<typeof ScoreEventPayloadSchema>;

export const ScoreEventInputSchema = z.object({
  clientEventId: IdSchema,
  deviceId: IdSchema,
  occurredAt: z.string().datetime({ offset: true }),
  payload: ScoreEventPayloadSchema
});
export type ScoreEventInput = z.infer<typeof ScoreEventInputSchema>;

export const ScoreEventSchema = ScoreEventInputSchema.extend({
  id: IdSchema,
  gameId: IdSchema,
  actorAccountId: IdSchema,
  authorityEpoch: z.number().int().positive(),
  sequence: z.number().int().positive(),
  recordedAt: z.string().datetime({ offset: true }),
  schemaVersion: z.string().min(1),
  rulesVersion: z.string().min(1),
  statSetVersion: z.string().min(1),
  correlationId: IdSchema
});
export type ScoreEvent = z.infer<typeof ScoreEventSchema>;

export const BatterLineSchema = z.object({
  athleteId: IdSchema,
  plateAppearances: z.number().int().nonnegative(),
  atBats: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  walks: z.number().int().nonnegative(),
  strikeouts: z.number().int().nonnegative(),
  rbi: z.number().int().nonnegative()
});
export type BatterLine = z.infer<typeof BatterLineSchema>;

export const GameSnapshotSchema = z.object({
  gameId: IdSchema,
  revision: z.number().int().nonnegative(),
  status: z.enum(["SCHEDULED", "LIVE", "FINAL"]),
  inning: z.number().int().positive(),
  half: z.enum(["TOP", "BOTTOM"]),
  outs: z.number().int().min(0).max(3),
  homeRuns: z.number().int().nonnegative(),
  awayRuns: z.number().int().nonnegative(),
  batterLines: z.array(BatterLineSchema),
  updatedAt: z.string().datetime({ offset: true })
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export const AccountSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"])
});
export type AccountDto = z.infer<typeof AccountSchema>;

export const TeamSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  seasonId: IdSchema,
  status: z.enum(["ACTIVE", "ARCHIVED"])
});
export type TeamDto = z.infer<typeof TeamSchema>;

export const GameSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  homeTeamName: z.string().min(1),
  awayTeamName: z.string().min(1),
  scheduledAt: z.string().datetime({ offset: true }),
  status: z.enum(["SCHEDULED", "LIVE", "FINAL", "CANCELLED"])
});
export type GameDto = z.infer<typeof GameSchema>;

export const AthleteProfileSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  displayName: z.string().min(1),
  jerseyNumber: z.string().optional(),
  loginEnabled: z.literal(false)
});
export type AthleteProfileDto = z.infer<typeof AthleteProfileSchema>;

export const RoleGrantSchema = z.object({
  id: IdSchema,
  accountId: IdSchema,
  role: RoleSchema,
  scopeType: z.enum(["PLATFORM", "TEAM", "GAME"]),
  scopeId: IdSchema.nullable(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  expiresAt: z.string().datetime({ offset: true }).optional()
});
export type RoleGrantDto = z.infer<typeof RoleGrantSchema>;

export const ScorerAuthoritySchema = z.object({
  gameId: IdSchema,
  accountId: IdSchema,
  authorityEpoch: z.number().int().positive(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  assignedAt: z.string().datetime({ offset: true }),
  assignedBy: IdSchema
});
export type ScorerAuthorityDto = z.infer<typeof ScorerAuthoritySchema>;

export const PolicyConfigSchema = z.object({
  regionCode: z.string().min(1),
  policyVersion: z.string().min(1),
  accountMinAge: z.number().int().positive().nullable(),
  guardianConsentMode: z.string().min(1),
  publicSharingEnabled: z.literal(false),
  athleteLoginEnabled: z.literal(false),
  retentionDays: z.number().int().positive().nullable(),
  deletionSlaDays: z.number().int().positive().nullable()
});
export type PolicyConfigDto = z.infer<typeof PolicyConfigSchema>;

export const BootstrapResponseSchema = z.object({
  account: AccountSchema,
  grants: z.array(RoleGrantSchema).min(1),
  policy: PolicyConfigSchema,
  pilot: z.object({
    team: TeamSchema,
    game: GameSchema,
    athletes: z.array(AthleteProfileSchema),
    authority: ScorerAuthoritySchema.optional(),
    snapshot: GameSnapshotSchema
  })
});
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;

export const GameEventsResponseSchema = z.object({
  events: z.array(ScoreEventSchema),
  latestSequence: z.number().int().nonnegative()
});
export type GameEventsResponse = z.infer<typeof GameEventsResponseSchema>;

export const AppendScoreBatchRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  authorityEpoch: z.number().int().positive(),
  rulesVersion: z.string().min(1),
  statSetVersion: z.string().min(1),
  events: z.array(ScoreEventInputSchema).min(1).max(100)
});
export type AppendScoreBatchRequest = z.infer<typeof AppendScoreBatchRequestSchema>;

export const AppendScoreBatchResponseSchema = z.object({
  acceptedClientEventIds: z.array(IdSchema),
  duplicateClientEventIds: z.array(IdSchema),
  quarantinedClientEventIds: z.array(IdSchema),
  rebased: z.boolean(),
  snapshot: GameSnapshotSchema
});
export type AppendScoreBatchResponse = z.infer<typeof AppendScoreBatchResponseSchema>;

export const AssignScorerRequestSchema = z.object({
  accountId: IdSchema,
  reason: z.string().trim().min(1).max(500)
});

export const StartStreamRequestSchema = z.object({
  idempotencyKey: IdSchema,
  requestedQuality: z.literal("720p").default("720p")
});

export const PlaybackAuthorizationRequestSchema = z.object({
  recordingId: IdSchema.optional()
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ReasonCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.unknown()).optional()
  })
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const RealtimeAuthorizationResponseSchema = z.object({
  allowed: z.literal(true),
  accountId: IdSchema
});
export type RealtimeAuthorizationResponse = z.infer<typeof RealtimeAuthorizationResponseSchema>;

export const RealtimeClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("AUTH"), token: z.string().min(1) }),
  z.object({
    type: z.literal("SUBSCRIBE_GAME"),
    gameId: IdSchema,
    afterSequence: z.number().int().nonnegative()
  }),
  z.object({ type: z.literal("PING"), at: z.string().datetime({ offset: true }) })
]);
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>;

export const RealtimeServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("AUTH_PENDING") }),
  z.object({ type: z.literal("AUTHENTICATED"), accountId: IdSchema }),
  z.object({ type: z.literal("SCORE_EVENT"), event: ScoreEventSchema }),
  z.object({ type: z.literal("SNAPSHOT_REQUIRED"), gameId: IdSchema, latestSequence: z.number().int().nonnegative() }),
  z.object({ type: z.literal("PONG"), at: z.string().datetime({ offset: true }) }),
  z.object({ type: z.literal("ERROR"), code: ReasonCodeSchema, message: z.string() })
]);
export type RealtimeServerMessage = z.infer<typeof RealtimeServerMessageSchema>;
