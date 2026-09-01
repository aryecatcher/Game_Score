import type { Action, Id, Role } from "@gamechanger/contracts";
import type { Game, RoleGrant } from "./types.js";

export interface AuthorizationContext {
  accountId: Id;
  action: Action;
  teamId?: Id;
  game?: Game;
  grants: readonly RoleGrant[];
  membershipActive?: boolean;
  consentSatisfied?: boolean;
  contentBlocked?: boolean;
}

export type AuthorizationDecision =
  | { allowed: true; matchedRole: Role }
  | { allowed: false; reason: "ROLE_MISSING" | "SCOPE_MISMATCH" | "MEMBERSHIP_REVOKED" | "CONSENT_REQUIRED" | "CONTENT_BLOCKED" };

const actionRoles: Record<Action, readonly Role[]> = {
  TEAM_UPDATE: ["TEAM_STAFF"],
  ROSTER_MANAGE: ["TEAM_STAFF"],
  SCORER_ASSIGN: ["TEAM_STAFF"],
  SCORE_EVENT_APPEND: ["OFFICIAL_SCOREKEEPER"],
  SCORE_CORRECT: ["OFFICIAL_SCOREKEEPER"],
  STREAM_START: ["VIDEOGRAPHER", "TEAM_STAFF"],
  PLAYBACK_AUTHORIZE: ["TEAM_STAFF", "OFFICIAL_SCOREKEEPER", "VIDEOGRAPHER", "GUARDIAN_FAMILY", "APPROVED_FAN"],
  CONTENT_TAKEDOWN: ["TEAM_STAFF", "PLATFORM_ADMIN"],
  QUOTA_GRANT: ["PLATFORM_ADMIN"],
  AUDIT_READ: ["PLATFORM_ADMIN"]
};

export function authorize(context: AuthorizationContext): AuthorizationDecision {
  if (context.contentBlocked === true && context.action === "PLAYBACK_AUTHORIZE") {
    return { allowed: false, reason: "CONTENT_BLOCKED" };
  }
  if (context.membershipActive === false && context.action === "PLAYBACK_AUTHORIZE") {
    return { allowed: false, reason: "MEMBERSHIP_REVOKED" };
  }
  if (context.consentSatisfied === false && context.action === "PLAYBACK_AUTHORIZE") {
    return { allowed: false, reason: "CONSENT_REQUIRED" };
  }

  const required = actionRoles[context.action];
  const active = context.grants.filter((grant) => {
    if (grant.accountId !== context.accountId || grant.status !== "ACTIVE") return false;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) return false;
    return required.includes(grant.role);
  });
  if (active.length === 0) return { allowed: false, reason: "ROLE_MISSING" };

  const teamId = context.teamId ?? context.game?.teamId;
  const scoped = active.find((grant) => {
    if (grant.scopeType === "PLATFORM") return grant.role === "PLATFORM_ADMIN";
    if (grant.scopeType === "TEAM") return grant.scopeId === teamId;
    return grant.scopeType === "GAME" && grant.scopeId === context.game?.id;
  });
  return scoped ? { allowed: true, matchedRole: scoped.role } : { allowed: false, reason: "SCOPE_MISMATCH" };
}
