import "dotenv/config";
import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const optionalPositiveInt = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : Number(value)),
  z.number().int().positive().optional()
);

const boolFromString = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean()
);

const optionalUuid = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().uuid().optional()
);

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MODE: z.enum(["memory", "postgres"]).default("memory"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4100),
  REALTIME_HOST: z.string().default("127.0.0.1"),
  REALTIME_PORT: z.coerce.number().int().positive().default(4101),
  API_INTERNAL_URL: z.string().url().default("http://127.0.0.1:4100"),
  INTERNAL_SERVICE_TOKEN: z.string().min(16).default("local-only-change-me"),
  DATABASE_URL: optionalNonEmpty,
  REDIS_URL: optionalNonEmpty,
  OBJECT_STORAGE_ENDPOINT: optionalNonEmpty,
  OBJECT_STORAGE_BUCKET: optionalNonEmpty,
  AUTH_PROVIDER: z.enum(["dev", "oidc"]).default("dev"),
  OIDC_ISSUER: optionalNonEmpty,
  OIDC_AUDIENCE: optionalNonEmpty,
  VIDEO_PROVIDER: z.enum(["mock", "aws-ivs", "mux"]).default("mock"),
  POLICY_REGION_CODE: z.string().default("UNSET"),
  POLICY_VERSION: z.string().default("draft-local"),
  ACCOUNT_MIN_AGE: optionalPositiveInt,
  PUBLIC_SHARING_ENABLED: boolFromString.default(false),
  ATHLETE_LOGIN_ENABLED: boolFromString.default(false),
  GUARDIAN_CONSENT_MODE: z.string().default("pilot-review-required"),
  BASEBALL_RULES_VERSION: z.string().default("draft-0.1"),
  OFFICIAL_STAT_SET_VERSION: z.string().default("draft-unapproved"),
  FREE_VIDEO_QUOTA_MINUTES: optionalPositiveInt,
  PILOT_MAX_TEAMS: optionalPositiveInt,
  PILOT_PEAK_CONCURRENT_VIEWERS: optionalPositiveInt,
  PILOT_TEAM_ID: optionalUuid,
  PILOT_GAME_ID: optionalUuid
});

export type Environment = z.infer<typeof EnvironmentSchema>;

const insecureInternalServiceTokens = new Set([
  "local-only-change-me",
  "replace-with-a-long-random-local-secret"
]);

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const env = EnvironmentSchema.parse(source);
  const missing: string[] = [];

  if (env.APP_MODE === "postgres" && !env.DATABASE_URL) missing.push("DATABASE_URL");
  if (env.AUTH_PROVIDER === "oidc" && !env.OIDC_ISSUER) missing.push("OIDC_ISSUER");
  if (env.AUTH_PROVIDER === "oidc" && !env.OIDC_AUDIENCE) missing.push("OIDC_AUDIENCE");
  if (env.NODE_ENV === "production" && env.POLICY_REGION_CODE === "UNSET") missing.push("POLICY_REGION_CODE");
  if (env.NODE_ENV === "production" && env.APP_MODE !== "postgres") missing.push("APP_MODE=postgres");
  if (env.NODE_ENV === "production" && !env.REDIS_URL) missing.push("REDIS_URL");
  if (env.NODE_ENV === "production" && env.AUTH_PROVIDER === "dev") missing.push("AUTH_PROVIDER=oidc");
  if (env.NODE_ENV === "production" && env.VIDEO_PROVIDER === "mock") missing.push("VIDEO_PROVIDER");
  if (env.NODE_ENV === "production" && !env.PILOT_TEAM_ID) missing.push("PILOT_TEAM_ID");
  if (env.NODE_ENV === "production" && !env.PILOT_GAME_ID) missing.push("PILOT_GAME_ID");
  if (env.NODE_ENV === "production" && env.OFFICIAL_STAT_SET_VERSION.startsWith("draft")) missing.push("OFFICIAL_STAT_SET_VERSION");
  if (env.NODE_ENV === "production" && insecureInternalServiceTokens.has(env.INTERNAL_SERVICE_TOKEN)) {
    missing.push("INTERNAL_SERVICE_TOKEN");
  }
  if (env.PUBLIC_SHARING_ENABLED) {
    throw new Error("P0 forbids public sharing; PUBLIC_SHARING_ENABLED must be false.");
  }
  if (env.ATHLETE_LOGIN_ENABLED) {
    throw new Error("P0 forbids athlete login; ATHLETE_LOGIN_ENABLED must be false.");
  }
  if (missing.length > 0) {
    throw new Error(`Required production configuration is missing: ${missing.join(", ")}`);
  }
  return env;
}
