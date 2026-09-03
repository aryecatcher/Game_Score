import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./index.js";

const productionEnvironment = {
  NODE_ENV: "production",
  APP_MODE: "postgres",
  DATABASE_URL: "postgres://gamechanger:secret@database.invalid/gamechanger",
  REDIS_URL: "redis://redis.invalid:6379",
  AUTH_PROVIDER: "oidc",
  OIDC_ISSUER: "https://identity.invalid/",
  OIDC_AUDIENCE: "gamechanger-api",
  VIDEO_PROVIDER: "aws-ivs",
  POLICY_REGION_CODE: "US",
  OFFICIAL_STAT_SET_VERSION: "baseball-v1",
  PILOT_TEAM_ID: "10000000-0000-4000-8000-000000000001",
  PILOT_GAME_ID: "20000000-0000-4000-8000-000000000001"
} satisfies NodeJS.ProcessEnv;

describe("loadEnvironment", () => {
  it("rejects the documented placeholder internal token in production", () => {
    expect(() => loadEnvironment({
      ...productionEnvironment,
      INTERNAL_SERVICE_TOKEN: "replace-with-a-long-random-local-secret"
    })).toThrow(/INTERNAL_SERVICE_TOKEN/);
  });
});
